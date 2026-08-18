#!/usr/bin/env python3
"""Build a graphify knowledge graph of this repo, with three KSCW-specific fixes.

    npm run graph          # ~25s, pure tree-sitter AST, 0 LLM tokens

Outputs land in graphify-out/ (gitignored): graph.html (interactive), graph.json
(full graph), GRAPH_REPORT.md (audit report).

A default `graphify .` on this repo is wrong in three ways. All three are fixed
here, and all three fixes are free — no LLM, no API key, no semantic pass.

1. SQL grammar
   graphify does not bundle tree_sitter_sql, so all 328 .sql files (18% of the
   corpus — every migration plus SCHEMA.sql) contribute NOTHING behind a single
   warning. Hard-gated below rather than warned about, because a graph that
   silently omits the data model looks complete.

2. tsconfig project references
   graphify's alias loader follows `extends` chains but not `references`. This
   repo uses the Vite split layout (tsconfig.json is files:[] + references; the
   `@/*` paths live in tsconfig.app.json), so `@/...` imports never resolved and
   ~675 internal edges became orphan `ref_*` stubs. Without the patch, cn() —
   the single most connected node in the repo at 522 edges — is invisible.

3. SQL <-> app bridge
   The .sql layer is statically disconnected from the app: the frontend reaches
   Postgres over the Directus REST API at runtime, which no AST can see. The
   join key that does exist in source is the collection name, quoted identically
   on both sides: fetchItems('members') / database('members') in code vs
   CREATE TABLE public.members in SQL. Bridging merges SCHEMA.sql into the main
   component and makes migration impact analysis reach real components.

Honesty contract: bridge edges are emitted as relation="queries",
confidence="INFERRED", _origin="bridge" and never masquerade as AST ground
truth. For AST-only ground truth, drop relation in {"queries", "indirect_call"}.
("indirect_call" is graphify's own heuristic and is 100% noise on this repo —
every instance is a local identifier colliding with a function name elsewhere,
e.g. a `const [teamId] = useState()` reported as calling eventHelpers.teamId().)
"""

from __future__ import annotations

import collections
import json
import os
import re
import subprocess
import sys
from pathlib import Path

OUT = Path("graphify-out")

EXCLUDES = [
    "*.min.js", "*.min.mjs", "*.min.cjs",
    "docs/code-graph/vendor/", "**/vendor/**",
    "dist/", "dist-ssr/", "build/", "node_modules/",
    "playwright-report/", "test-results/",
]

# Directories scanned for data-access call sites when building the SQL bridge.
BRIDGE_SOURCES = [
    (Path("src"), {".ts", ".tsx"}),
    (Path("directus/extensions/kscw-endpoints/src"), {".js"}),
    (Path("directus/scripts"), {".mjs"}),
]

# Functions whose string argument names a Directus collection / PG table.
# Anchored to a call site: a bare string-literal match doubles the hit count
# with i18n keys, CSS classes and comments.
_ACCESSORS = (
    "fetchItems", "fetchItem", "fetchAllItems", "countItems", "aggregateItems",
    "createRecord", "createRecords", "updateRecord", "updateRecords",
    "deleteRecord", "deleteRecords", "useCollection",
    "readItems", "readItem", "createItem", "updateItem", "deleteItem",
    "database", "knex",
)
# name  [<Generic, args>]  (  'table'   — the generic form is common here,
# e.g. fetchAllItems<Absence>('absences', ...)
CALL_RE = re.compile(
    r"\b(?:" + "|".join(_ACCESSORS) + r")\s*(?:<[^>()]{0,120}>)?\s*\(\s*['\"]([a-z][a-z0-9_]{2,45})['\"]"
)
FROM_RE = re.compile(r"\.\s*(?:from|table)\s*\(\s*['\"]([a-z][a-z0-9_]{2,45})['\"]")
PROP_RE = re.compile(r"\bcollection\s*:\s*['\"]([a-z][a-z0-9_]{2,45})['\"]")
BRIDGE_PATTERNS = (CALL_RE, FROM_RE, PROP_RE)


# --------------------------------------------------------------------------- #
# Bootstrap: re-exec under graphify's own interpreter
# --------------------------------------------------------------------------- #
def ensure_graphify_interpreter() -> None:
    """Re-exec under the interpreter that has graphify, so `npm run graph` works.

    graphify is installed as a uv tool, not into any project venv, so the
    ambient python3 cannot import it.
    """
    try:
        import graphify  # noqa: F401
        return
    except ImportError:
        pass

    pinned = OUT / ".graphify_python"
    candidates = []
    if pinned.exists():
        candidates.append(pinned.read_text(encoding="utf-8").strip())
    try:
        found = subprocess.run(
            ["uv", "tool", "run", "--from", "graphifyy", "python", "-c",
             "import sys; print(sys.executable)"],
            capture_output=True, text=True, timeout=120,
        )
        if found.returncode == 0 and found.stdout.strip():
            candidates.append(found.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass

    for candidate in candidates:
        if candidate and candidate != sys.executable and Path(candidate).exists():
            probe = subprocess.run([candidate, "-c", "import graphify"], capture_output=True)
            if probe.returncode == 0:
                os.execv(candidate, [candidate, os.path.abspath(__file__), *sys.argv[1:]])

    sys.exit(
        "graphify is not installed.\n"
        "  uv tool install graphifyy\n"
        "Do NOT pip install it: system python is PEP 668 externally-managed and "
        "lacks ensurepip, so pip install and python3 -m venv both fail."
    )


def ensure_sql_grammar() -> None:
    """Hard-gate on tree_sitter_sql — 328 .sql files depend on it."""
    try:
        import tree_sitter_sql  # noqa: F401
        return
    except ImportError:
        pass
    sys.exit(
        "tree_sitter_sql is missing — all 328 .sql files (18% of the corpus, "
        "including SCHEMA.sql and every migration) would silently contribute "
        "nothing.\n\n"
        f"  uv pip install --python {sys.executable} tree-sitter-sql\n\n"
        "Note: graphify's uv tool venv has no pip, so `python -m pip install` "
        "fails there. `uv pip install --python <that interpreter>` is additive "
        "and leaves graphify itself untouched."
    )


# --------------------------------------------------------------------------- #
# Fix 2: make graphify follow tsconfig `references`
# --------------------------------------------------------------------------- #
def patch_tsconfig_references() -> dict:
    """Teach graphify's alias loader to follow tsconfig project references.

    NOTE: _load_tsconfig_aliases is *defined* in graphify.extractors.resolution
    and only re-exported from graphify.extract, so its globals resolve in the
    defining module. Patching graphify.extract instead is a silent no-op.
    """
    import graphify.extractors.resolution as R

    original = R._read_tsconfig_aliases

    def with_references(tsconfig: Path, base_dir: Path, seen: set) -> dict:
        aliases = original(tsconfig, base_dir, seen)
        try:
            raw = tsconfig.read_text(encoding="utf-8")
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = json.loads(R._strip_jsonc(raw))
        except Exception:
            return aliases
        for ref in data.get("references") or []:
            target = ref.get("path") if isinstance(ref, dict) else None
            if not target:
                continue
            path = (base_dir / target).resolve()
            if not path.suffix:
                path = path / "tsconfig.json"
            if path.exists():
                for key, value in original(path, path.parent, seen).items():
                    aliases.setdefault(key, value)  # the config's own paths win
        return aliases

    R._read_tsconfig_aliases = with_references
    R._TSCONFIG_ALIAS_CACHE.clear()
    return R._load_tsconfig_aliases(Path("src").resolve())


# --------------------------------------------------------------------------- #
# Fix 3: bridge the SQL layer to the app
# --------------------------------------------------------------------------- #
def sql_table_nodes(nodes: list[dict]) -> dict[str, str]:
    """Bare table name -> node id, preferring the canonical SCHEMA.sql node.

    Functions and triggers (label ends in "()") are excluded; only relations.
    """
    tables: dict[str, str] = {}
    for node in nodes:
        source = node.get("source_file") or ""
        label = node.get("label") or ""
        if not source.endswith(".sql"):
            continue
        if not label.startswith("public.") or label.endswith("()"):
            continue
        name = label[len("public."):]
        if name not in tables or source.endswith("SCHEMA.sql"):
            tables[name] = node["id"]
    return tables


def file_level_nodes(nodes: list[dict]) -> dict[str, str]:
    """Source path -> its file-level node id (the shortest id for that file)."""
    best: dict[str, str] = {}
    for node in nodes:
        source = node.get("source_file")
        if not source:
            continue
        current = best.get(source)
        if current is None or len(node["id"]) < len(current):
            best[source] = node["id"]
    return best


def build_bridge(nodes: list[dict]) -> tuple[list[dict], dict]:
    tables = sql_table_nodes(nodes)
    files = file_level_nodes(nodes)
    node_ids = {n["id"] for n in nodes}

    edges: list[dict] = []
    seen: set[tuple[str, str]] = set()
    per_table: dict[str, set[str]] = collections.defaultdict(set)

    for root, suffixes in BRIDGE_SOURCES:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            key = str(path)
            file_node = files.get(key)
            if file_node is None or file_node not in node_ids:
                continue  # file contributed no nodes
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for pattern in BRIDGE_PATTERNS:
                for match in pattern.finditer(text):
                    table = tables.get(match.group(1))
                    if table is None or table == file_node:
                        continue
                    pair = (file_node, table)
                    if pair in seen:
                        continue
                    seen.add(pair)
                    per_table[match.group(1)].add(key)
                    edges.append({
                        "source": file_node,
                        "target": table,
                        "relation": "queries",
                        "confidence": "INFERRED",
                        "source_file": key,
                        "source_location": f"L{text.count(chr(10), 0, match.start()) + 1}",
                        "weight": 0.7,
                        "_origin": "bridge",
                    })

    stats = {
        "tables_total": len(tables),
        "tables_bridged": len(per_table),
        "edges": len(edges),
        "frontend_files": len({f for v in per_table.values() for f in v if f.startswith("src/")}),
        "backend_files": len({f for v in per_table.values() for f in v if not f.startswith("src/")}),
        "top": sorted(((len(v), k) for k, v in per_table.items()), reverse=True)[:10],
    }
    return edges, stats


# --------------------------------------------------------------------------- #
# Community labelling (auto-derived, so labels survive re-clustering)
# --------------------------------------------------------------------------- #
_PRETTY = {
    "src/components/ui": "shadcn UI primitives",
    "src/components/aceternity": "Aceternity effects",
    "src/components/magicui": "Magic UI components",
    "src/i18n": "i18n locale bundles",
    "src/lib": "Directus API client",
    "src/hooks": "Shared hooks",
    "src/utils": "Shared utils",
    "src/types": "Shared types",
    "directus/extensions/kscw-endpoints/src": "Backend endpoints",
    "directus/scripts": "DB schema & scripts",
}


def auto_label(node_ids: list[str], nodes_by_id: dict[str, dict]) -> str:
    dirs: collections.Counter = collections.Counter()
    for nid in node_ids:
        source = (nodes_by_id.get(nid) or {}).get("source_file")
        if not source:
            continue
        parts = Path(source).parts
        for depth in (4, 3, 2):
            if len(parts) > depth:
                dirs["/".join(parts[:depth])] += 1
                break
        else:
            dirs["/".join(parts[:-1]) or "(root)"] += 1
    if not dirs:
        return "Unclassified"
    top, count = dirs.most_common(1)[0]
    name = _PRETTY.get(top, top)
    return name if count / max(1, len(node_ids)) >= 0.4 else f"{name} (mixed)"


# --------------------------------------------------------------------------- #
def main() -> None:
    if not Path("package.json").exists() or not Path("directus").is_dir():
        sys.exit("Run from the wiedisync repo root (npm run graph).")

    ensure_sql_grammar()
    aliases = patch_tsconfig_references()
    if not aliases:
        print("WARNING: tsconfig aliases did not resolve — '@/...' edges will be lost.")
    else:
        print(f"tsconfig aliases: {aliases}")

    from graphify.detect import detect, save_manifest
    from graphify.extract import collect_files, extract
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json
    from graphify.diagnostics import diagnose_extraction
    from graphify.cli import _stamped_manifest_files
    import networkx as nx

    OUT.mkdir(exist_ok=True)
    (OUT / ".graphify_python").write_text(sys.executable, encoding="utf-8")

    detection = detect(Path("."), extra_excludes=EXCLUDES)
    print(f"detect: {detection['total_files']} files")

    code_files: list[Path] = []
    for entry in detection.get("files", {}).get("code", []):
        path = Path(entry)
        code_files.extend(collect_files(path) if path.is_dir() else [path])

    ast = extract(code_files, cache_root=Path("."), root=Path("."))
    print(f"AST: {len(ast['nodes'])} nodes, {len(ast['edges'])} edges")

    bridge_edges, stats = build_bridge(ast["nodes"])
    print(
        f"bridge: {stats['edges']} queries-edges over "
        f"{stats['tables_bridged']}/{stats['tables_total']} tables "
        f"({stats['frontend_files']} frontend + {stats['backend_files']} backend files)"
    )
    for count, table in stats["top"]:
        print(f"   {table:34s} {count:3d} file(s)")

    extraction = {
        "nodes": ast["nodes"],
        "edges": ast["edges"] + bridge_edges,
        "hyperedges": [],
        "input_tokens": 0,
        "output_tokens": 0,
    }

    diag = diagnose_extraction(extraction, directed=False, root=".")
    flags = [
        f"{diag[k]} {label}"
        for k, label in (
            ("dangling_endpoint_edges", "dangling-endpoint edges"),
            ("missing_endpoint_edges", "missing-endpoint edges"),
            ("self_loop_edges", "self-loop edges"),
            ("undirected_same_endpoint_collapsed_edges", "collapsed (undirected) edges"),
        )
        if diag.get(k, 0)
    ]
    # Expected on a healthy run: ~2266 dangling (external npm + node builtins,
    # which have no source file in the corpus), 1 self-loop (finance_transactions
    # has a genuine self-referencing FK), ~578 collapsed (a SQL view reading one
    # table on many lines collapses to one edge in a simple Graph).
    print("GRAPH HEALTH: " + ("; ".join(flags) if flags else "OK"))

    graph = build_from_json(extraction, root=".", directed=False)
    if graph.number_of_nodes() == 0:
        sys.exit("ERROR: graph is empty — extraction produced no nodes.")

    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    nodes_by_id = {n["id"]: n for n in extraction["nodes"]}
    labels = {cid: auto_label(members, nodes_by_id) for cid, members in communities.items()}

    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    questions = suggest_questions(graph, communities, labels)

    # The graph shape changes between runs, so clear the previous export rather
    # than tripping graphify's shrink-guard (#479) on a legitimate rebuild.
    (OUT / "graph.json").unlink(missing_ok=True)
    if not to_json(graph, communities, str(OUT / "graph.json"), community_labels=labels):
        sys.exit("ERROR: graph.json refused to write.")
    (OUT / "GRAPH_REPORT.md").write_text(
        generate(graph, communities, cohesion, labels, gods, surprises, detection,
                 {"input": 0, "output": 0}, ".", suggested_questions=questions),
        encoding="utf-8",
    )
    (OUT / ".graphify_labels.json").write_text(
        json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding="utf-8")

    components = sorted(nx.connected_components(graph), key=len, reverse=True)
    largest = components[0]
    print(
        f"Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, "
        f"{len(communities)} communities"
    )
    print(
        f"components: {len(components)} | largest {len(largest)} "
        f"({100 * len(largest) / graph.number_of_nodes():.1f}%) | "
        f"SCHEMA.sql bridged into it: {'directus_scripts_schema' in largest}"
    )

    corpus = detection.get("all_files") or detection["files"]
    manifest = _stamped_manifest_files(corpus, extraction, Path("."))
    semantic = {f for t, fl in detection["files"].items()
                if t in ("document", "paper", "image") for f in fl}
    stamped = {f for fl in manifest.values() for f in fl}
    save_manifest(manifest, root=".",
                  scan_corpus={f for fl in corpus.values() for f in fl},
                  clear_semantic=(semantic - stamped) or None)

    sys.stdout.flush()  # else the subprocess's output interleaves ahead of ours
    subprocess.run(["graphify", "export", "html"], check=False)
    print("\nOutputs in graphify-out/ · 0 LLM tokens")
    print("  graph.html       interactive graph (aggregated: >5000 nodes)")
    print("  GRAPH_REPORT.md  audit report")
    print("  graph.json       full graph")


if __name__ == "__main__":
    ensure_graphify_interpreter()
    main()
