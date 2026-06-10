// Export helpers: styled PDF via an offscreen window, plus folder reveal.
const { BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Minimal markdown renderer — enough for our summary format
// (headings, bullets, bold/italic, paragraphs). Escapes HTML first.
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  const lines = esc(md).split('\n');
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    const t = line.trim();
    if (/^###\s/.test(t)) { closeList(); html += `<h3>${inline(t.slice(4))}</h3>`; }
    else if (/^##\s/.test(t)) { closeList(); html += `<h2>${inline(t.slice(3))}</h2>`; }
    else if (/^#\s/.test(t)) { closeList(); html += `<h1>${inline(t.slice(2))}</h1>`; }
    else if (/^[-*]\s/.test(t)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(t.slice(2))}</li>`;
    } else if (t === '') { closeList(); }
    else { closeList(); html += `<p>${inline(t)}</p>`; }
  }
  closeList();
  return html;
}

function pdfDocument({ title, date, duration, summaryMd, aiPolished }) {
  const badge = aiPolished
    ? '<span class="badge">✦ AI-polished</span>'
    : '<span class="badge plain">Extractive summary</span>';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 18mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #2c1f14; line-height: 1.55; font-size: 11.5pt; }
    .head { border-bottom: 2.5px solid #f4623a; padding-bottom: 10px; margin-bottom: 22px; }
    .head h1 { font-family: Verdana, Geneva, sans-serif; font-size: 17pt; margin: 0 0 6px; letter-spacing: -0.01em; }
    .meta { color: #7a6555; font-size: 9.5pt; font-family: Verdana, Geneva, sans-serif; }
    .badge { display:inline-block; background:#8fb98a; color:#fff; font-family: Verdana, sans-serif;
             font-size:8pt; padding:2px 9px; border-radius:9px; margin-left:8px; vertical-align: 1px; }
    .badge.plain { background:#f5c842; color:#2c1f14; }
    h2 { font-family: Verdana, Geneva, sans-serif; font-size: 13pt; color:#f4623a; margin: 22px 0 8px; }
    h3 { font-family: Verdana, Geneva, sans-serif; font-size: 11pt; margin: 16px 0 6px; }
    ul { margin: 6px 0 12px 20px; padding: 0; }
    li { margin-bottom: 4px; }
    p { margin: 0 0 9px; }
    code { font-family: 'Courier New', monospace; background:#f5ede0; padding: 1px 4px; border-radius: 3px; font-size: 10pt; }
  </style></head><body>
    <div class="head">
      <h1>${title}</h1>
      <div class="meta">${date} &middot; ${duration} ${badge}</div>
    </div>
    ${mdToHtml(summaryMd)}
  </body></html>`;
}

async function exportPdf(opts, savePath) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pdfDocument(opts)));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    fs.writeFileSync(savePath, pdf);
    return savePath;
  } finally {
    win.destroy();
  }
}

function revealInFolder(dir) {
  shell.openPath(path.resolve(dir));
}

module.exports = { exportPdf, revealInFolder };
