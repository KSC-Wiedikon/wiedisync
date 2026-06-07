#!/usr/bin/env node
// Generate Layer-1 Markdown (import dependency graph) from import-graph.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const g = JSON.parse(readFileSync(join(ROOT, 'docs/code-graph/import-graph.json'), 'utf8'));

const FOUNDATION = ['lib', 'utils', 'hooks', 'components', 'ui', 'types', 'i18n', 'data', 'assets'];
const isMod = (a) => a.startsWith('modules/');
const short = (a) => a.replace('modules/', '');
const id = (a) => a.replace(/[^a-zA-Z0-9]/g, '_');

// --- module -> foundation usage matrix ---
const matrixCols = ['lib', 'hooks', 'utils', 'ui', 'components', 'types', 'i18n'];
const modUsage = new Map(); // mod -> {col: count}
for (const e of g.areaEdges) {
  if (isMod(e.from) && matrixCols.includes(e.to)) {
    const row = modUsage.get(e.from) || {};
    row[e.to] = e.count; modUsage.set(e.from, row);
  }
}

// --- foundation internal edges ---
const foundEdges = g.areaEdges.filter((e) => FOUNDATION.includes(e.from) && FOUNDATION.includes(e.to));

// --- module -> module edges (cross-feature coupling) ---
const modModEdges = g.areaEdges.filter((e) => isMod(e.from) && isMod(e.to));

// --- module -> non-module aggregator targets (admin/hallenplan/guide are imported by others) ---

let md = '';
md += '# Layer 1 — Import Dependency Graph (mechanical)\n\n';
md += `Derived by parsing every static + dynamic import in \`src/\` (\`extract-graph.mjs\`). `;
md += `**${g.totalFiles} files**, **${g.totalLoc.toLocaleString()} LOC**, **${g.areas.length} areas**, **${g.areaEdges.length} cross-area edges**. `;
md += `Edges are exact (resolved \`@/\` alias + relative paths); counts = number of import statements crossing the boundary.\n\n`;

// ---------- areas table ----------
md += '## Areas (by size & coupling)\n\n';
md += '`in` = import statements pointing *into* the area (how depended-upon it is); `out` = imports it makes outward.\n\n';
md += '| Area | LOC | Files | In | Out |\n|---|--:|--:|--:|--:|\n';
for (const a of g.areas) {
  if (a.files === 0) continue;
  md += `| \`${a.area}\` | ${a.loc.toLocaleString()} | ${a.files} | ${a.inDeg} | ${a.outDeg} |\n`;
}
md += '\n';

// ---------- foundation diagram ----------
md += '## Foundation layer (shared internals)\n\n';
md += 'These areas are imported by everything; the diagram shows how they depend on *each other*. ';
md += '`i18n` and `types` are leaves (in-degree only — nothing they import internally is graphed).\n\n';
md += '```mermaid\ngraph LR\n';
for (const f of FOUNDATION) {
  const a = g.areas.find((x) => x.area === f);
  if (a) md += `  ${id(f)}["${f}<br/>in:${a.inDeg} out:${a.outDeg}"]\n`;
}
for (const e of foundEdges) md += `  ${id(e.from)} -->|${e.count}| ${id(e.to)}\n`;
md += '```\n\n';

// ---------- cross-module coupling ----------
md += '## Cross-feature coupling (module → module)\n\n';
md += 'Feature modules mostly fan *down* into the foundation and rarely import each other. ';
md += 'The few module→module edges below are the real cross-feature dependencies — everything else is decoupled.\n\n';
if (modModEdges.length === 0) {
  md += '_None — modules are fully decoupled from each other._\n\n';
} else {
  md += '```mermaid\ngraph LR\n';
  const nodes = new Set();
  for (const e of modModEdges) { nodes.add(e.from); nodes.add(e.to); }
  for (const n of nodes) md += `  ${id(n)}["${short(n)}"]\n`;
  for (const e of modModEdges) md += `  ${id(e.from)} -->|${e.count}| ${id(e.to)}\n`;
  md += '```\n\n';
  md += '| From | To | Imports |\n|---|---|--:|\n';
  for (const e of modModEdges.sort((a, b) => b.count - a.count)) md += `| \`${short(e.from)}\` | \`${short(e.to)}\` | ${e.count} |\n`;
  md += '\n';
}

// ---------- module -> foundation matrix ----------
md += '## Module → foundation usage matrix\n\n';
md += 'How heavily each feature module leans on each shared area (import-statement counts). Blank = no direct import.\n\n';
md += '| Module | ' + matrixCols.map((c) => `\`${c}\``).join(' | ') + ' |\n';
md += '|---|' + matrixCols.map(() => '--:').join('|') + '|\n';
const mods = [...modUsage.keys()].sort((a, b) => {
  const sa = Object.values(modUsage.get(a)).reduce((x, y) => x + y, 0);
  const sb = Object.values(modUsage.get(b)).reduce((x, y) => x + y, 0);
  return sb - sa;
});
for (const m of mods) {
  const row = modUsage.get(m);
  md += `| \`${short(m)}\` | ` + matrixCols.map((c) => row[c] ? String(row[c]) : '').join(' | ') + ' |\n';
}
md += '\n';

// ---------- top edges ----------
md += '## Top 25 cross-area edges\n\n';
md += '| From | To | Imports |\n|---|---|--:|\n';
for (const e of g.areaEdges.slice(0, 25)) md += `| \`${e.from}\` | \`${e.to}\` | ${e.count} |\n`;
md += '\n';

writeFileSync(join(ROOT, 'docs/code-graph/layer1-imports.md'), md);
console.log(`wrote layer1-imports.md (${md.length} bytes)`);
console.log(`foundationEdges=${foundEdges.length} modModEdges=${modModEdges.length} modulesInMatrix=${mods.length}`);
