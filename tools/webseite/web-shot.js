// mit Electron: ganze Webseite als Bild (hell/dunkel, PC/Handy)
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const PAGE = require('path').join(__dirname, '..', '..', 'webseite', process.env.PAGE || 'index.html');
const OUT = path.join(__dirname, 'web');
async function shot(theme, width, name) {
  nativeTheme.themeSource = theme;
  const win = new BrowserWindow({ show: false, x: -4000, y: 0, width, height: 900 }); win.showInactive();
  await win.loadFile(PAGE);
  await new Promise((r) => setTimeout(r, 1500));
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  if (width < 600) await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
  let h = await win.webContents.executeJavaScript('document.documentElement.scrollHeight'); let y0 = 0;
  if (process.env.SEL) { const r = await win.webContents.executeJavaScript('(()=>{const t=document.querySelector(' + JSON.stringify(process.env.SEL) + ').getBoundingClientRect(); const top=' + Number(process.env.VOR || 40) + '; return [t.top+scrollY-top, t.height+top+40]})()'); y0 = r[0]; h = r[1]; }
  await win.webContents.executeJavaScript('document.querySelectorAll("img[loading=lazy]").forEach(i=>i.loading="eager"); 1');
  await new Promise((r) => setTimeout(r, 1200));
  const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: true, clip: { x: 0, y: y0, width, height: h, scale: width < 600 ? 1 : 0.75 } });
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), Buffer.from(r.data, 'base64'));
  console.log(name, width, h);
  win.destroy();
}
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const [theme, width, name] = (process.env.SHOTARGS || 'light 1440 x').split(' ');
  await shot(theme, Number(width), name);
  app.quit();
});
