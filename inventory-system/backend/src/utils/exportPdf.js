/** Server-side PDF export storage. Generated files stay on the inventory system,
 * rather than relying on a browser's download location. */
const fs = require('fs');
const path = require('path');
const { exportDir } = require('../config');
const { createPdfDocument, pdfMoney } = require('./pdf');

function safeName(value) {
  return String(value || 'export').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
}
function destination(name) {
  fs.mkdirSync(exportDir, { recursive: true });
  return path.join(exportDir, `${safeName(name)}.pdf`);
}
function value(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Write any report data as a readable A4 PDF and resolve only once it is saved. */
function saveReportPdf({ name, title, subtitle = '', data }) {
  const filePath = destination(name);
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const { doc, writeText, setBold } = createPdfDocument({ margin: 40 });
    output.on('finish', () => resolve({ filePath, fileName: path.basename(filePath) }));
    output.on('error', reject);
    doc.on('error', reject);
    doc.pipe(output);
    setBold(true); doc.fontSize(18); writeText(title);
    setBold(false); doc.fontSize(9).fillColor('#555');
    if (subtitle) writeText(subtitle);
    writeText(`Generated: ${new Date().toLocaleString('en-IN')}`); doc.fillColor('#000'); doc.moveDown();

    const addLine = (label, val) => { setBold(true); writeText(`${label}: `, { continued: true }); setBold(false); writeText(value(val)); };
    const addRows = (rows, label) => {
      if (!Array.isArray(rows) || !rows.length) return;
      if (doc.y > 650) doc.addPage();
      setBold(true); doc.fontSize(12); writeText(label); setBold(false); doc.fontSize(8);
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r || {})))].slice(0, 6);
      const widths = keys.map(() => 500 / Math.max(keys.length, 1));
      let y = doc.y;
      keys.forEach((k, i) => { setBold(true); writeText(k.replace(/_/g, ' '), { x: 45 + widths.slice(0, i).reduce((a, b) => a + b, 0), y, width: widths[i] - 4 }); });
      setBold(false); y += 15;
      rows.slice(0, 250).forEach((row) => {
        if (y > 735) { doc.addPage(); y = 45; }
        keys.forEach((k, i) => writeText(value(row[k]).slice(0, 50), { x: 45 + widths.slice(0, i).reduce((a, b) => a + b, 0), y, width: widths[i] - 4 }));
        y += 16;
      });
      doc.y = y + 8;
    };
    Object.entries(data || {}).forEach(([key, item]) => {
      if (Array.isArray(item)) addRows(item, key.replace(/([A-Z])/g, ' $1'));
      else if (item && typeof item === 'object') {
        setBold(true); doc.fontSize(12); writeText(key.replace(/([A-Z])/g, ' $1')); setBold(false); doc.fontSize(9);
        Object.entries(item).forEach(([k, v]) => Array.isArray(v) ? addRows(v, k) : (v && typeof v === 'object' ? null : addLine(k.replace(/_/g, ' '), v)));
        doc.moveDown(0.5);
      } else addLine(key.replace(/_/g, ' '), item);
    });
    doc.end();
  });
}

function mirrorDocumentPdf(doc, name) { doc.pipe(fs.createWriteStream(destination(name))); }
module.exports = { saveReportPdf, mirrorDocumentPdf, destination };
