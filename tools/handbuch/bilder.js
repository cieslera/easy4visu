'use strict';
/**
 * Bilder für das Handbuch aufnehmen (helles Design). Läuft als UI-Prüfung im Demo Talwerk:
 *   E4_DATA_DIR=<leerer Ordner> E4_UI_CHECK=tools/handbuch/bilder.js SHOT=<Ausgabeordner> electron . --demo-talwerk
 * Mit LEER=1 (ohne --demo-talwerk) nur die Bilder eines neuen, leeren Projekts.
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function check(win) {
  const wc = win.webContents;
  const js = (c) => wc.executeJavaScript(c, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = process.env.SHOT;
  fs.mkdirSync(out, { recursive: true });
  win.setSize(1600, 900); win.showInactive(); await sleep(7000);
  const clean = () => js(`(()=>{const b=document.getElementById('demoband'); if(b) b.remove(); document.querySelectorAll('.toast').forEach(t=>t.remove()); return 1})()`);
  const rect = (sel) => js(`(()=>{const n=document.querySelector(${JSON.stringify(sel)}); if(!n) return null; const t=n.getBoundingClientRect(); return {x:Math.max(0,Math.round(t.left)),y:Math.max(0,Math.round(t.top)),width:Math.round(t.width),height:Math.round(Math.min(t.height, innerHeight-Math.max(0,t.top)))}})()`);
  const shot = async (name, sel) => {
    await clean(); await sleep(300);
    const r = sel ? await rect(sel) : null;
    fs.writeFileSync(path.join(out, `${name}.png`), (await (r ? wc.capturePage(r) : wc.capturePage())).toPNG());
    console.log('[H]', name, sel && !r ? '(Element fehlt)' : '');
  };
  const click = async (sel, wait) => { const ok = await js(`(()=>{const n=document.querySelector(${JSON.stringify(sel)}); if(n) n.click(); return !!n})()`); await sleep(wait || 1500); return ok; };
  const clickText = async (sel, text, wait) => { const ok = await js(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim().includes(${JSON.stringify(text)})); if(n) n.click(); return !!n})()`); await sleep(wait || 1500); return ok; };
  const esc = async () => { await js(`(()=>{const c=document.querySelector('#modal [aria-label="Schließen"], #modal .iconbtn'); if(c) c.click(); return 1})()`); await sleep(800); };
  const light = () => clickText('.topbar .seg button', 'Hell', 1200);

  if (process.env.LEER) {
    await light();
    await shot('01-erste-schritte');
    await click('[data-test="add-device"]', 1500);
    await shot('02-neues-geraet');
    return true;
  }

  // ---- Bedienseiten (Demo läuft im Bedienmodus)
  await clickText('.fkey', 'Hell', 1500);
  await shot('20-bedienseite-uebersicht');
  await clickText('.fkey', 'Druckluft', 2000); await shot('21-bedienseite-druckluft');
  await clickText('.fkey', 'Meldungen', 2000); await shot('22-bedienseite-meldungen');
  await clickText('.fkey', 'Übersicht', 1500);
  await click('[data-test="bar-lang"]', 800); await shot('23-sprachwahl', '.vbar');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1`); await sleep(500);

  // ---- Einrichten
  await clickText('.fkey', 'Verlassen', 2000);
  await light();
  await click('[data-test="nav-devices"]'); await shot('03-geraete');
  for (const [i, name] of [[0, '04-geraet-modbus'], [2, '05-geraet-webserver'], [1, '06-geraet-mqtt']]) {
    await js(`(()=>{const b=[...document.querySelectorAll('.devcard')][${i}].querySelector('button'); b.click(); return 1})()`); await sleep(1500);
    await js(`(()=>{const d=[...document.querySelectorAll('#modal details')]; d.forEach(x=>x.open=true); return d.length})()`); await sleep(500);
    await shot(name);
    await clickText('#modal button', 'Abbrechen', 1000);
  }
  await click('[data-test="nav-variables"]'); await shot('07-variablen');
  await js(`(()=>{const r=document.querySelector('[data-var-row], tbody tr'); if(r) r.click(); return !!r})()`); await sleep(1200);
  await shot('09-variable-bearbeiten');
  await esc(); await clickText('#modal button', 'Abbrechen', 800);
  const B = path.join(__dirname, '..', '..', 'beispiele', 'musterwerk');
  if (fs.existsSync(B)) {
    await click('[data-test="import"]', 4000); await shot('08-variablen-einlesen');
    await clickText('#modal button', 'Abbrechen', 1000);
  }

  // Editor
  await click('[data-test="nav-editor"]', 3000); await shot('10-editor');
  await js(`(()=>{const n=document.querySelector('#edcanvas [data-item="v1"]'); if(!n) return 0; const r=n.getBoundingClientRect();
    const o={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height-30,pointerId:1,button:0,isPrimary:true};
    n.dispatchEvent(new PointerEvent('pointerdown',o)); window.dispatchEvent(new PointerEvent('pointerup',o)); n.dispatchEvent(new PointerEvent('pointerup',o)); n.click(); return 1})()`);
  await sleep(1500); await shot('11-editor-element');
  await clickText('.edtabs button', 'Symbole', 1200); await shot('12-editor-symbole');
  await clickText('.edtabs button', 'Elemente', 800);
  await clickText('button', 'Leisten (Vorlage)', 2000); await shot('13-editor-leisten');
  await clickText('button', 'Leisten (Vorlage)', 1500);

  // Verwaltung
  await click('[data-test="nav-alarms"]'); await shot('14-meldungen');
  await click('[data-test="nav-texts"]'); await shot('15-sprachen');
  await click('[data-test="nav-records"]'); await shot('16-aufzeichnungen');
  await click('[data-test="nav-project"]'); await shot('17-projekt');
  await click('[data-test="nav-options"]', 1500); await shot('18-einstellungen');
  await click('[data-test="open-design"]', 2500); await shot('19-design');

  // Benutzer: in der Demo (Kopie, wird nicht gespeichert) drei Benutzer anlegen
  try {
    await js(`window.e4.userAdd({ name: 'Meister', role: 'setup', password: 'demo1234' })`);
    await js(`window.e4.userAdd({ name: 'Schicht A', role: 'operator', pin: '1234' })`);
    await js(`window.e4.userAdd({ name: 'Anzeige Halle', role: 'viewer', pin: '9999' })`);
  } catch (e) { console.log('[H] Benutzer:', e.message); }
  await sleep(800);
  await click('[data-test="nav-users"]'); await shot('24-benutzer');
  await click('[data-test="nav-audit"]'); await shot('25-bedienprotokoll');
  await click('[data-test="nav-web"]'); await shot('26-handy-tablet');
  return true;
};
