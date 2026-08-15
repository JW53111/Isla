// CDP 检测：连上 isla 的调试端口，读取画布状态 + 截屏页面内容
const list = await (await fetch('http://127.0.0.1:9222/json')).json();
console.log('TARGETS:', list.map((t) => `${t.type}:${t.url}`).join(' | '));
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log('NO_PAGE');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (
    m.method === 'Runtime.exceptionThrown' ||
    m.method === 'Runtime.consoleAPICalled' ||
    m.method === 'Log.entryAdded'
  ) {
    events.push(m);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await new Promise((r) => {
  ws.onopen = r;
});
await send('Runtime.enable');
await send('Log.enable');
await new Promise((r) => setTimeout(r, 1500));
const ev = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    canvas: (() => { const c = document.getElementById('pet-canvas'); return c ? { w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height } : null; })(),
    inner: [innerWidth, innerHeight],
    hasCanvasContent: (() => { const c = document.getElementById('pet-canvas'); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 100), Math.min(c.height, 100)).data; for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) return true; } return false; })()
  })`,
  returnByValue: true,
});
console.log('STATE:', ev.result?.result?.value);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync('.tmp/page-shot.png', Buffer.from(shot.result.data, 'base64'));
console.log('SHOT:', shot.result ? 'saved' : 'fail');
console.log('EVENTS:', events.length ? events.map((e) => e.method + '|' + JSON.stringify(e.params?.exceptionDetails?.text || e.params?.entry?.text || e.params?.args?.map(a => a.value).join(' ') || '')).join(' ;; ') : 'none');
process.exit(0);
