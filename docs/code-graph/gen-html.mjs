#!/usr/bin/env node
// Build a single self-contained interactive HTML page from import-graph.json +
// the 5 markdown docs + inlined render libs (marked, vis-network, mermaid).
// Output: graph.html (open directly in a browser, works fully offline).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'docs/code-graph');
const read = (p) => readFileSync(join(DIR, p), 'utf8');
// Prevent any inlined content from breaking out of its <script> tag.
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

// ---- libs (inline if fetched, else fall back to CDN <script src>) ----
function libTag(file, cdn) {
  if (existsSync(join(DIR, 'vendor', file))) return `<script>${safe(read('vendor/' + file))}</script>`;
  return `<script src="${cdn}"></script>`;
}
const markedTag = libTag('marked.min.js', 'https://cdn.jsdelivr.net/npm/marked@12/marked.min.js');
const visTag = libTag('vis-network.min.js', 'https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js');
const mermaidTag = libTag('mermaid.min.js', 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js');

// ---- graph data ----
const g = JSON.parse(read('import-graph.json'));
const FOUNDATION = new Set(['lib', 'utils', 'hooks', 'components', 'ui', 'types', 'i18n', 'data', 'assets']);
const typeOf = (a) => a.startsWith('modules/') ? 'module' : (FOUNDATION.has(a) ? 'foundation' : 'root');

// area-level
const areaNodes = g.areas.filter((a) => a.files > 0).map((a) => ({
  id: a.area, label: a.area.replace('modules/', ''), area: a.area,
  type: typeOf(a.area), loc: a.loc, files: a.files, in: a.inDeg, out: a.outDeg,
}));
const areaEdges = g.areaEdges.map((e) => ({ from: e.from, to: e.to, count: e.count }));

// file-level: resolve each dep prefix to a real file node
const fileKeys = new Set(Object.keys(g.fileInfo));
const cand = (p) => [`${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`, `${p}.js`, `${p}.jsx`];
const resolve = (p) => cand(p).find((c) => fileKeys.has(c)) || null;
const fileNodes = Object.entries(g.fileInfo).map(([id, v]) => ({
  id, label: id.split('/').pop(), area: v.area, type: typeOf(v.area), loc: v.loc,
}));
const fileIdx = new Map(fileNodes.map((n, i) => [n.id, i]));
const fileEdgeSet = new Set();
const fileEdges = [];
for (const [from, v] of Object.entries(g.fileInfo)) {
  for (const dep of v.deps) {
    const to = resolve(dep);
    if (!to || to === from) continue;
    const key = `${from}|${to}`;
    if (fileEdgeSet.has(key)) continue;
    fileEdgeSet.add(key);
    fileEdges.push([fileIdx.get(from), fileIdx.get(to)]);
  }
}

// distinct color per area (for file view), deterministic by index
const allAreas = [...new Set(fileNodes.map((n) => n.area))].sort();
const areaColor = {};
allAreas.forEach((a, i) => { areaColor[a] = `hsl(${Math.round((i * 137.508) % 360)} 65% 55%)`; });

const DATA = { areaNodes, areaEdges, fileNodes, fileEdges, areaColor, allAreas, totals: { files: g.totalFiles, loc: g.totalLoc, areas: areaNodes.length, edges: areaEdges.length } };

// ---- docs ----
const DOCS = {
  'README': read('README.md'),
  'Layer 1 · imports': read('layer1-imports.md'),
  'Layer 2 · data model': read('layer2-data-model.md'),
  'Layer 2 · backend': read('layer2-backend.md'),
  'Layer 2 · features': read('layer2-features.md'),
};
const jsonScript = (id, obj) => `<script type="application/json" id="${id}">${safe(JSON.stringify(obj)).replace(/<\//g, '<\\/')}</script>`;

// ---- assemble ----
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>wiedisync · code knowledge graph</title>
<style>
:root{
  --bg:#0f1419; --panel:#171c24; --panel2:#1f2630; --border:#2b3340;
  --fg:#e6edf3; --muted:#8b97a7; --accent:#4f9cf9;
  --foundation:#3b82f6; --module:#22c55e; --root:#eab308;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent)}
#app{display:flex;height:100vh;overflow:hidden}
#side{width:220px;flex:0 0 220px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column}
#side h1{font-size:14px;margin:0;padding:16px 16px 4px;letter-spacing:.3px}
#side .sub{padding:0 16px 12px;color:var(--muted);font-size:12px}
.tab{padding:10px 16px;cursor:pointer;border-left:3px solid transparent;color:var(--muted);user-select:none}
.tab:hover{background:var(--panel2);color:var(--fg)}
.tab.active{background:var(--panel2);color:var(--fg);border-left-color:var(--accent)}
#side .foot{margin-top:auto;padding:12px 16px;color:var(--muted);font-size:11px;border-top:1px solid var(--border)}
#main{flex:1;position:relative;overflow:hidden}
.view{position:absolute;inset:0;display:none}
.view.active{display:block}
#graphWrap{position:absolute;inset:0}
#net{position:absolute;inset:0}
#controls{position:absolute;top:12px;left:12px;z-index:5;background:rgba(23,28,36,.92);backdrop-filter:blur(6px);border:1px solid var(--border);border-radius:10px;padding:12px;width:250px;max-height:calc(100% - 24px);overflow:auto}
#controls h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.ctl{margin-bottom:10px}
.ctl label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.seg{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.seg button{flex:1;background:var(--panel2);color:var(--muted);border:0;padding:6px;cursor:pointer;font-size:12px}
.seg button.on{background:var(--accent);color:#06121f;font-weight:600}
#search,#areaFilter{width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--fg);border-radius:8px;padding:6px 8px;font-size:13px}
.legend{display:flex;flex-direction:column;gap:4px;font-size:12px}
.legend .row{display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 4px;border-radius:6px}
.legend .row:hover{background:var(--panel2)}
.legend .row.off{opacity:.4}
.dot{width:11px;height:11px;border-radius:50%;flex:0 0 11px}
.btn{width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--fg);border-radius:8px;padding:7px;cursor:pointer;font-size:12px;margin-top:4px}
.btn:hover{border-color:var(--accent)}
#info{position:absolute;top:12px;right:12px;z-index:5;background:rgba(23,28,36,.95);border:1px solid var(--border);border-radius:10px;padding:12px 14px;width:280px;display:none}
#info h4{margin:0 0 6px;font-size:14px;word-break:break-all}
#info .k{color:var(--muted)}
#info table{width:100%;font-size:12px;border-collapse:collapse}
#info td{padding:2px 0}
#info td:last-child{text-align:right;font-variant-numeric:tabular-nums}
#info .nbr{margin-top:8px;max-height:160px;overflow:auto;font-size:12px}
#info .nbr div{padding:2px 0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc{position:absolute;inset:0;overflow:auto;padding:32px 48px}
.doc-inner{max-width:1000px;margin:0 auto}
.doc h1{border-bottom:1px solid var(--border);padding-bottom:8px}
.doc h2{margin-top:32px;border-bottom:1px solid var(--border);padding-bottom:6px}
.doc code{background:var(--panel2);padding:2px 5px;border-radius:4px;font-size:13px}
.doc pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px;overflow:auto}
.doc pre code{background:none;padding:0}
.doc table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
.doc th,.doc td{border:1px solid var(--border);padding:6px 10px;text-align:left}
.doc th{background:var(--panel2)}
.doc tr:nth-child(even) td{background:rgba(255,255,255,.02)}
.doc .mermaid{background:#fff;border-radius:8px;padding:14px;margin:14px 0;text-align:center}
.hint{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:5;background:rgba(23,28,36,.9);border:1px solid var(--border);border-radius:20px;padding:6px 14px;font-size:12px;color:var(--muted)}
.vis-tooltip{position:absolute;background:#171c24;border:1px solid #2b3340;color:#e6edf3;border-radius:6px;padding:6px 8px;font:12px sans-serif;pointer-events:none;z-index:9}
@media(max-width:720px){#side{width:54px;flex-basis:54px}#side h1,#side .sub,#side .foot,.tab span{display:none}.tab{text-align:center;padding:12px 0}.doc{padding:20px}}
</style>
</head>
<body>
<div id="app">
  <nav id="side">
    <h1>wiedisync</h1>
    <div class="sub">code knowledge graph</div>
    <div class="tabs" id="tabs"></div>
    <div class="foot">${DATA.totals.files} files · ${DATA.totals.loc.toLocaleString()} LOC<br/>${DATA.totals.areas} areas · ${DATA.totals.edges} edges<br/>generated 2026-06-07</div>
  </nav>
  <main id="main">
    <section class="view active" id="view-graph">
      <div id="graphWrap"><div id="net"></div></div>
      <div id="controls">
        <h3>Dependency graph</h3>
        <div class="ctl"><label>Granularity</label>
          <div class="seg"><button id="lvlArea" class="on">Areas (33)</button><button id="lvlFile">Files (773)</button></div>
        </div>
        <div class="ctl"><label>Search node</label><input id="search" placeholder="filter by name…"/></div>
        <div class="ctl" id="areaFilterWrap" style="display:none"><label>Isolate area</label><select id="areaFilter"></select></div>
        <div class="ctl"><label>Node type</label>
          <div class="legend" id="legend">
            <div class="row" data-type="foundation"><span class="dot" style="background:var(--foundation)"></span>Foundation</div>
            <div class="row" data-type="module"><span class="dot" style="background:var(--module)"></span>Feature module</div>
            <div class="row" data-type="root"><span class="dot" style="background:var(--root)"></span>App root</div>
          </div>
        </div>
        <button class="btn" id="physToggle">Freeze layout</button>
        <button class="btn" id="resetView">Reset view</button>
      </div>
      <div id="info"></div>
      <div class="hint">Drag to pan · scroll to zoom · click a node to highlight its dependencies</div>
    </section>
  </main>
</div>

${jsonScript('graph-data', DATA)}
${jsonScript('docs-data', DOCS)}
${markedTag}
${visTag}
${mermaidTag}
<script>
const DATA = JSON.parse(document.getElementById('graph-data').textContent);
const DOCS = JSON.parse(document.getElementById('docs-data').textContent);
const TYPE_COLOR = { foundation:'#3b82f6', module:'#22c55e', root:'#eab308' };

// ---------- tabs ----------
const tabsEl = document.getElementById('tabs');
function mkTab(id, label){ const d=document.createElement('div'); d.className='tab'; d.dataset.view=id; d.innerHTML='<span>'+label+'</span>'; tabsEl.appendChild(d); return d; }
mkTab('graph','◆ Dependency graph').classList.add('active');
const docViews = {};
Object.keys(DOCS).forEach((name,i)=>{
  const id='doc'+i; mkTab(id,'▤ '+name);
  const sec=document.createElement('section'); sec.className='view'; sec.id='view-'+id;
  sec.innerHTML='<div class="doc"><div class="doc-inner" id="docinner-'+id+'"></div></div>';
  document.getElementById('main').appendChild(sec);
  docViews[id]={name,rendered:false};
});
tabsEl.addEventListener('click',e=>{
  const t=e.target.closest('.tab'); if(!t)return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  const v=t.dataset.view; document.getElementById('view-'+v).classList.add('active');
  if(docViews[v]&&!docViews[v].rendered) renderDoc(v);
  if(v==='graph'&&network) network.redraw();
});

// ---------- markdown + mermaid ----------
mermaid.initialize({ startOnLoad:false, theme:'default', securityLevel:'loose' });
function renderDoc(v){
  const d=docViews[v];
  const inner=document.getElementById('docinner-'+v);
  inner.innerHTML=marked.parse(DOCS[d.name]);
  // convert fenced mermaid code blocks into mermaid divs
  inner.querySelectorAll('code.language-mermaid').forEach(c=>{
    const div=document.createElement('div'); div.className='mermaid'; div.textContent=c.textContent;
    c.closest('pre').replaceWith(div);
  });
  mermaid.run({ querySelector:'#docinner-'+v+' .mermaid' }).catch(()=>{});
  d.rendered=true;
}

// ---------- network ----------
let network=null, nodes=null, edges=null, level='area', physics=true;
const disabledTypes=new Set();

function sizeForLoc(loc){ return Math.max(8, Math.min(60, Math.sqrt(loc)/3)); }

function buildArea(){
  const ns=DATA.areaNodes.filter(n=>!disabledTypes.has(n.type)).map(n=>({
    id:n.id, label:n.label, value:n.loc, color:{background:TYPE_COLOR[n.type],border:'#0b0f14'},
    title:n.area+' — '+n.loc.toLocaleString()+' LOC, '+n.files+' files (in '+n.in+' / out '+n.out+')',
    font:{color:'#e6edf3',size:13}, shape:'dot', size:sizeForLoc(n.loc),
  }));
  const ids=new Set(ns.map(n=>n.id));
  const es=DATA.areaEdges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({
    from:e.from,to:e.to,value:e.count,title:e.count+' imports',arrows:'to',
    color:{color:'rgba(139,151,167,.28)',highlight:'#4f9cf9'},smooth:{type:'continuous'},
  }));
  return {ns,es};
}
function buildFile(){
  const sel=document.getElementById('areaFilter').value;
  let keep=DATA.fileNodes.map((n,i)=>({n,i})).filter(o=>!disabledTypes.has(o.n.type));
  let keepIdx=new Set(keep.map(o=>o.i));
  if(sel!=='*'){
    // keep files in area + direct neighbors
    const inArea=new Set(DATA.fileNodes.map((n,i)=>n.area===sel?i:-1).filter(i=>i>=0));
    const nbr=new Set(inArea);
    DATA.fileEdges.forEach(([a,b])=>{ if(inArea.has(a))nbr.add(b); if(inArea.has(b))nbr.add(a); });
    keepIdx=new Set([...keepIdx].filter(i=>nbr.has(i)));
  }
  const ns=[...keepIdx].map(i=>{const n=DATA.fileNodes[i];return{
    id:i, label:n.label, value:n.loc, shape:'dot', size:sizeForLoc(n.loc)*0.7,
    color:{background:DATA.areaColor[n.area],border:'#0b0f14'},
    title:n.id+' — '+n.loc+' LOC ['+n.area+']', font:{color:'#cbd5e1',size:10},
  };});
  const es=DATA.fileEdges.filter(([a,b])=>keepIdx.has(a)&&keepIdx.has(b)).map(([a,b])=>({
    from:a,to:b,arrows:'to',color:{color:'rgba(139,151,167,.15)',highlight:'#4f9cf9'},smooth:false,
  }));
  return {ns,es};
}
function render(){
  const built = level==='area'?buildArea():buildFile();
  nodes=new vis.DataSet(built.ns); edges=new vis.DataSet(built.es);
  const opts={
    nodes:{borderWidth:1.5,scaling:{min:8,max:60}},
    edges:{selectionWidth:2},
    physics:{enabled:physics, barnesHut:{gravitationalConstant:level==='area'?-8000:-3000,springLength:level==='area'?140:60,springConstant:.04,damping:.4}, stabilization:{iterations: level==='area'?300:120}},
    interaction:{hover:true,tooltipDelay:120,hideEdgesOnDrag:level==='file'},
    layout:{improvedLayout: level==='area'},
  };
  if(network) network.destroy();
  network=new vis.Network(document.getElementById('net'),{nodes,edges},opts);
  network.on('click',params=>{ params.nodes.length?selectNode(params.nodes[0]):clearSel(); });
  network.once('stabilizationIterationsDone',()=>{ if(level==='file'){ network.setOptions({physics:false}); physics=false; document.getElementById('physToggle').textContent='Resume layout'; }});
}
function selectNode(id){
  const conn=new Set([id]);
  network.getConnectedNodes(id).forEach(n=>conn.add(n));
  nodes.update(nodes.get().map(n=>({id:n.id,opacity:conn.has(n.id)?1:0.12})));
  const cEdges=new Set(network.getConnectedEdges(id));
  edges.update(edges.get().map(e=>({id:e.id,hidden:!cEdges.has(e.id)})));
  showInfo(id,conn);
}
function clearSel(){
  if(nodes) nodes.update(nodes.get().map(n=>({id:n.id,opacity:1})));
  if(edges) edges.update(edges.get().map(e=>({id:e.id,hidden:false})));
  document.getElementById('info').style.display='none';
}
function showInfo(id,conn){
  const info=document.getElementById('info');
  if(level==='area'){
    const n=DATA.areaNodes.find(x=>x.id===id);
    const outs=DATA.areaEdges.filter(e=>e.from===id).sort((a,b)=>b.count-a.count);
    const ins=DATA.areaEdges.filter(e=>e.to===id).sort((a,b)=>b.count-a.count);
    info.innerHTML='<h4>'+n.area+'</h4><table>'+
      '<tr><td class="k">LOC</td><td>'+n.loc.toLocaleString()+'</td></tr>'+
      '<tr><td class="k">Files</td><td>'+n.files+'</td></tr>'+
      '<tr><td class="k">Imported by (in)</td><td>'+n.in+'</td></tr>'+
      '<tr><td class="k">Imports out</td><td>'+n.out+'</td></tr></table>'+
      '<div class="nbr"><b>→ depends on</b>'+(outs.length?outs.map(e=>'<div>'+e.to.replace('modules/','')+' ·'+e.count+'</div>').join(''):'<div>—</div>')+
      '<b>← depended on by</b>'+(ins.length?ins.map(e=>'<div>'+e.from.replace('modules/','')+' ·'+e.count+'</div>').join(''):'<div>—</div>')+'</div>';
  } else {
    const n=DATA.fileNodes[id];
    const deps=[...conn].filter(x=>x!==id).map(x=>DATA.fileNodes[x]);
    info.innerHTML='<h4>'+n.id+'</h4><table><tr><td class="k">LOC</td><td>'+n.loc+'</td></tr><tr><td class="k">Area</td><td>'+n.area+'</td></tr><tr><td class="k">Connected</td><td>'+deps.length+'</td></tr></table>'+
      '<div class="nbr">'+deps.slice(0,40).map(d=>'<div>'+d.id+'</div>').join('')+'</div>';
  }
  info.style.display='block';
}

// ---------- controls ----------
document.getElementById('lvlArea').onclick=()=>setLevel('area');
document.getElementById('lvlFile').onclick=()=>setLevel('file');
function setLevel(l){
  if(level===l)return; level=l; physics=true;
  document.getElementById('lvlArea').classList.toggle('on',l==='area');
  document.getElementById('lvlFile').classList.toggle('on',l==='file');
  document.getElementById('areaFilterWrap').style.display=l==='file'?'block':'none';
  document.getElementById('physToggle').textContent='Freeze layout';
  clearSel(); render();
}
document.getElementById('search').addEventListener('input',e=>{
  const q=e.target.value.trim().toLowerCase(); if(!nodes)return;
  if(!q){ nodes.update(nodes.get().map(n=>({id:n.id,opacity:1}))); return; }
  nodes.update(nodes.get().map(n=>({id:n.id,opacity:(''+n.label).toLowerCase().includes(q)?1:0.12})));
});
const af=document.getElementById('areaFilter');
af.innerHTML='<option value="*">— all areas —</option>'+DATA.allAreas.map(a=>'<option value="'+a+'">'+a+'</option>').join('');
af.onchange=()=>{ clearSel(); render(); };
document.querySelectorAll('#legend .row').forEach(r=>{
  r.onclick=()=>{ const t=r.dataset.type; if(disabledTypes.has(t)){disabledTypes.delete(t);r.classList.remove('off');}else{disabledTypes.add(t);r.classList.add('off');} clearSel(); render(); };
});
document.getElementById('physToggle').onclick=function(){
  physics=!physics; network.setOptions({physics:{enabled:physics}}); this.textContent=physics?'Freeze layout':'Resume layout';
};
document.getElementById('resetView').onclick=()=>{ clearSel(); network.fit({animation:true}); };

render();
</script>
</body>
</html>`;

writeFileSync(join(DIR, 'graph.html'), html);
console.log(`wrote graph.html (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`area nodes=${areaNodes.length} area edges=${areaEdges.length} | file nodes=${fileNodes.length} file edges=${fileEdges.length}`);
