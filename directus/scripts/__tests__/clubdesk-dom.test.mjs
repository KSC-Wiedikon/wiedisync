import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickExact } from '../clubdesk-dom.mjs';

// The ClubDesk import wizard at its confirmation step, as the 19:29 15.09.2026
// commit run saw it (up-shots-prod/create-commit/import-2-summary.png):
//   · the contact grid behind everything, with a "Ja" cell of its own;
//   · the mapping dialog (one row of the CSV as label/value pairs) whose grid
//     SCROLLS — Nico Fortino's "Gast = Ja" row sits below the fold, clipped;
//   · a glass pane over all of that;
//   · the confirmation dialog on top, with its Ja / Nein buttons.
// Buttons record what was clicked and the Ja closes the dialog + glass, as
// ClubDesk's does.
const WIZARD = `<!doctype html><html><body style="margin:0;font:14px sans-serif">
<div id="contacts" style="position:absolute;top:0;left:0;width:1500px;height:950px;overflow:auto">
  <div style="position:absolute;top:800px;left:400px">Mitglieder (666 Einträge)</div>
  <div style="position:absolute;top:880px;left:900px" class="cell">Ja</div>
</div>
<div id="mapping" style="position:absolute;top:180px;left:220px;width:1060px;height:590px;background:#fff">
  <div id="mapgrid" style="position:absolute;top:60px;left:20px;width:1000px;height:440px;overflow:auto">
    ${Array.from({ length: 24 }, (_, i) => `<div style="height:33px">row ${i} <span class="cell">${i === 20 ? 'Ja' : i === 21 ? 'Nein' : 'x'}</span></div>`).join('')}
  </div>
  <button id="map-ok" style="position:absolute;top:550px;left:880px" onclick="window.__clicked='map-ok'">OK</button>
</div>
<div id="glass" style="position:absolute;inset:0;background:rgba(0,0,0,.25)"></div>
<div id="confirm" style="position:absolute;top:310px;left:450px;width:600px;height:330px;background:#fff">
  <p>Wollen Sie diese Änderungen übernehmen?</p>
  <button id="ja" style="position:absolute;top:290px;left:430px"
    onclick="window.__clicked='ja';document.getElementById('confirm').remove();document.getElementById('glass').remove()">Ja</button>
  <button id="nein" style="position:absolute;top:290px;left:500px" onclick="window.__clicked='nein'">Nein</button>
</div>
</body></html>`;

// The rule this replaced: any element with a non-zero rect, lowest on screen.
const pickLowestAnywhere = ({ exact }) => {
  const c = [...document.querySelectorAll('*')].filter((e) => {
    let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim() === exact;
  }).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const r = c.sort((a, b) => b.top - a.top)[0];
  return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
};

async function withWizard(fn) {
  let chromium;
  try { ({ chromium } = await import('@playwright/test')); } catch { return null; }
  let browser;
  try { browser = await chromium.launch(); } catch { return null; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
    await page.setContent(WIZARD);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test('"Ja" is the confirmation button, not the clipped Gast cell or the grid behind the glass', async (t) => {
  const r = await withWizard(async (page) => {
    const old = await page.evaluate(pickLowestAnywhere, { exact: 'Ja' });
    const pos = await page.evaluate(pickExact, { exact: 'Ja' });
    const button = await page.locator('#ja').boundingBox();
    await page.mouse.click(pos.x, pos.y);
    const clicked = await page.evaluate(() => window.__clicked);
    const stillOpen = await page.locator('#confirm').count();
    return { old, pos, button, clicked, stillOpen };
  });
  if (!r) return t.skip('Playwright / Chromium not available');
  // The old rule aimed below the dialog — at a mapping-grid row that is
  // scrolled out of its viewport (no button there, the click hit nothing).
  assert.ok(r.old.y > r.button.y + r.button.height, `old rule y=${r.old.y} should be below the button (${r.button.y})`);
  assert.ok(r.pos.x >= r.button.x && r.pos.x <= r.button.x + r.button.width, 'x inside the Ja button');
  assert.ok(r.pos.y >= r.button.y && r.pos.y <= r.button.y + r.button.height, 'y inside the Ja button');
  assert.equal(r.clicked, 'ja');
  assert.equal(r.stillOpen, 0, 'the confirmation closed after Ja');
});

test('"Nein" is the confirmation button, not the Gast = Nein cell', async (t) => {
  const r = await withWizard(async (page) => {
    const pos = await page.evaluate(pickExact, { exact: 'Nein' });
    await page.mouse.click(pos.x, pos.y);
    return await page.evaluate(() => window.__clicked);
  });
  if (!r) return t.skip('Playwright / Chromium not available');
  assert.equal(r, 'nein');
});

test('"OK" under the glass is not clickable → null (nothing to dismiss)', async (t) => {
  const r = await withWizard(async (page) => ({
    underGlass: await page.evaluate(pickExact, { exact: 'OK' }),
    // Once the confirmation and its glass are gone, the mapping dialog's OK is
    // the topmost thing at its own centre again.
    afterClose: await page.evaluate(() => {
      document.getElementById('confirm').remove(); document.getElementById('glass').remove();
      return true;
    }).then(() => page.evaluate(pickExact, { exact: 'OK' })),
  }));
  if (!r) return t.skip('Playwright / Chromium not available');
  assert.equal(r.underGlass, null);
  assert.ok(r.afterClose && r.afterClose.y > 700, 'mapping OK found once uncovered');
});

test('the import scraper runs pickExact from clubdesk-dom.mjs, not an inline copy', () => {
  const src = readFileSync(fileURLToPath(new URL('../clubdesk-scrape-import.mjs', import.meta.url)), 'utf8');
  assert.match(src, /import \{ pickExact \} from '\.\/clubdesk-dom\.mjs'/);
  assert.match(src, /page\.evaluate\(pickExact, \{ exact, lowest \}\)/);
});
