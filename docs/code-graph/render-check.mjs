import { chromium } from 'playwright';

const URL = 'file:///home/lucanepa/repos/wiedisync/docs/code-graph/graph.html';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500); // let vis stabilize

// graph rendered? vis-network draws a <canvas> inside #net
const canvas = await page.$('#net canvas');
console.log('graph canvas present:', !!canvas);

// click a node area to test highlight (click center of canvas)
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/cg-preview-graph.png' });

// switch to Files view
await page.click('#lvlFile');
await page.waitForTimeout(3500);
const fileCanvas = await page.$('#net canvas');
console.log('file-view canvas present:', !!fileCanvas);
await page.screenshot({ path: '/tmp/cg-preview-files.png' });

// open a doc tab with mermaid (Layer 2 data model = doc2)
const tabs = await page.$$('.tab');
let opened = null;
for (const t of tabs) { const txt = await t.innerText(); if (/data model/i.test(txt)) { await t.click(); opened = txt; break; } }
await page.waitForTimeout(2500);
const svgCount = await page.$$eval('.doc .mermaid svg', (els) => els.length).catch(() => 0);
console.log('opened doc tab:', opened, '| mermaid SVGs rendered:', svgCount);
await page.screenshot({ path: '/tmp/cg-preview-doc.png' });

console.log('\nCONSOLE ERRORS:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  -', e);
await browser.close();
process.exit(errors.length ? 2 : 0);
