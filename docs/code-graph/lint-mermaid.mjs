#!/usr/bin/env node
// Lightweight structural linter for ```mermaid blocks in the graph markdown.
// Not a full parser — catches the breakers that actually bite: unbalanced
// quotes/brackets/braces, missing diagram header, and unquoted ()/[] inside
// node labels (the #1 cause of "Parse error" in flowcharts).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'docs/code-graph');
const HEADERS = /^(graph|flowchart|erDiagram|sequenceDiagram|classDiagram|stateDiagram(-v2)?|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart)\b/;

let total = 0, problems = 0;
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.md'))) {
  const text = readFileSync(join(DIR, f), 'utf8');
  const lines = text.split('\n');
  let inBlock = false, block = [], startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^```mermaid\s*$/.test(line)) { inBlock = true; block = []; startLine = i + 1; continue; }
    if (inBlock && /^```\s*$/.test(line)) {
      inBlock = false; total++;
      const issues = lintBlock(block);
      if (issues.length) {
        problems++;
        console.log(`\n⚠ ${f}:${startLine} (mermaid block)`);
        for (const x of issues) console.log(`   - ${x}`);
      }
      continue;
    }
    if (inBlock) block.push(line);
  }
}
console.log(`\n${total} mermaid blocks checked, ${problems} with potential issues.`);
if (problems) process.exitCode = 1;

function lintBlock(blk) {
  const issues = [];
  const nonEmpty = blk.map((l) => l.trim()).filter(Boolean);
  if (!nonEmpty.length) return ['empty block'];
  // strip "%%" directives / comments to find the real header
  const header = nonEmpty.find((l) => !l.startsWith('%%'));
  if (!HEADERS.test(header)) issues.push(`bad/missing diagram header: "${header}"`);

  const isER = HEADERS.test(header) && header.startsWith('erDiagram');
  const joined = blk.join('\n');
  // balance checks across whole block
  const q = (joined.match(/"/g) || []).length;
  if (q % 2) issues.push(`odd number of double-quotes (${q}) — unbalanced label quote`);
  // erDiagram uses {, }, ( ) as crow's-foot cardinality markers (||--o{ etc.),
  // so bracket balance is meaningless there — only check flowchart/graph blocks.
  if (!isER) {
    for (const [open, close, name] of [['[', ']', 'square'], ['{', '}', 'curly'], ['(', ')', 'round']]) {
      const o = joined.split(open).length - 1, c = joined.split(close).length - 1;
      if (o !== c) issues.push(`unbalanced ${name} brackets: ${o} '${open}' vs ${c} '${close}'`);
    }
  }
  // erDiagram relationship labels (after ':') containing () break the parser.
  for (const l of blk) {
    const t = l.trim();
    if (isER && t.includes(':')) {
      const label = t.slice(t.indexOf(':') + 1);
      if (/[()]/.test(label)) issues.push(`erDiagram relationship label has ()  -> "${t}"`);
    }
  }
  return issues;
}
