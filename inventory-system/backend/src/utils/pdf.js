/**
 * PDF helpers with Gujarati support.
 *
 * PDFKit's built-in Helvetica is a WinAnsi font: it cannot render Gujarati and
 * has no rupee glyph, so bilingual invoices were previously unreadable.
 *
 * The Noto Sans Gujarati package ships *subsetted* font files — the "gujarati"
 * subset carries Gujarati letters and ₹ but no Latin letters or digits, while
 * the "latin" subset is the reverse. A single PDFKit font therefore cannot
 * cover a line like "Invoice INV-001 — ચોખા — ₹1,250.00".
 *
 * `writeText` solves this by splitting a string into runs of Gujarati and
 * non-Gujarati characters and drawing each run with the font that has the
 * glyphs, continuing on the same line. Callers that only ever emit ASCII can
 * keep using `doc.text` directly.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// TTFs are produced from the packaged WOFFs by scripts/build-fonts.js, which
// runs on postinstall. PDFKit cannot inflate WOFF table compression, so
// embedding the .woff directly renders every glyph as an empty box.
const FONT_DIR_CANDIDATES = [
  path.join(__dirname, '../../assets/fonts'),
  path.join(process.cwd(), 'assets/fonts'),
];

function findFontDir() {
  return FONT_DIR_CANDIDATES.find((d) => fs.existsSync(d)) || null;
}

function readFont(dir, subset, weight) {
  if (!dir) return null;
  const file = path.join(dir, `noto-${subset}-${weight}.ttf`);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

let cache;

function loadFonts() {
  if (cache) return cache;
  const dir = findFontDir();
  cache = {
    gujaratiRegular: readFont(dir, 'gujarati', 400),
    gujaratiBold: readFont(dir, 'gujarati', 700),
    latinRegular: readFont(dir, 'latin', 400),
    latinBold: readFont(dir, 'latin', 700),
  };
  return cache;
}

// Gujarati block, plus the rupee sign which only the Gujarati subset carries.
const GUJARATI_CHAR = /[\u0A80-\u0AFF\u20B9]/;

/**
 * Split text into runs that can each be drawn with a single font.
 * Whitespace attaches to the preceding run so spacing is preserved.
 */
function splitByScript(text) {
  const str = String(text ?? '');
  if (!str) return [];

  const runs = [];
  let current = '';
  let currentIsGujarati = null;

  for (const ch of str) {
    // Spaces exist in both subsets; keep them in the current run.
    const isGu = GUJARATI_CHAR.test(ch);
    const neutral = /\s/.test(ch);

    if (currentIsGujarati === null) {
      currentIsGujarati = neutral ? false : isGu;
      current = ch;
      continue;
    }
    if (neutral || isGu === currentIsGujarati) {
      current += ch;
    } else {
      runs.push({ text: current, gujarati: currentIsGujarati });
      current = ch;
      currentIsGujarati = isGu;
    }
  }
  if (current) runs.push({ text: current, gujarati: currentIsGujarati === true });
  return runs;
}

/**
 * Create a PDFDocument together with script-aware drawing helpers.
 *
 * Returns:
 *   doc          the PDFDocument
 *   regularFont  font name to use for plain ASCII text
 *   boldFont     bold equivalent
 *   unicode      true when the Gujarati fonts were found
 *   writeText    (text, opts) => void — handles mixed-script strings
 *   setBold      (bool) => void — selects the current weight
 */
function createPdfDocument(options = {}) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', ...options });
  const fonts = loadFonts();

  const names = {
    latinRegular: 'Helvetica',
    latinBold: 'Helvetica-Bold',
    gujaratiRegular: null,
    gujaratiBold: null,
  };

  const register = (key, label, buffer) => {
    if (!buffer) return;
    try {
      doc.registerFont(label, buffer);
      names[key] = label;
    } catch {
      // Leave the default in place if the font cannot be parsed.
    }
  };

  register('latinRegular', 'LatinRegular', fonts.latinRegular);
  register('latinBold', 'LatinBold', fonts.latinBold);
  register('gujaratiRegular', 'GujaratiRegular', fonts.gujaratiRegular);
  register('gujaratiBold', 'GujaratiBold', fonts.gujaratiBold);

  const unicode = !!names.gujaratiRegular;
  if (!names.latinBold) names.latinBold = names.latinRegular;
  if (unicode && !names.gujaratiBold) names.gujaratiBold = names.gujaratiRegular;

  let bold = false;
  const setBold = (value) => { bold = !!value; };

  const fontFor = (isGujarati) => {
    if (isGujarati && unicode) return bold ? names.gujaratiBold : names.gujaratiRegular;
    return bold ? names.latinBold : names.latinRegular;
  };

  /**
   * Draw text that may mix Gujarati and Latin.
   * Supports the subset of PDFKit options this project needs: x/y position,
   * `width`, `align`, and `continued`.
   */
  const writeText = (text, opts = {}) => {
    const runs = splitByScript(text);
    if (!runs.length) {
      doc.font(fontFor(false)).text('', opts.x, opts.y, opts);
      return;
    }

    // Single-script strings keep PDFKit's own layout (alignment, wrapping).
    if (runs.length === 1) {
      doc.font(fontFor(runs[0].gujarati));
      if (opts.x !== undefined && opts.y !== undefined) {
        doc.text(runs[0].text, opts.x, opts.y, opts);
      } else {
        doc.text(runs[0].text, opts);
      }
      return;
    }

    // Mixed scripts: draw the runs back to back on one line.
    const { x, y, align, width, ...rest } = opts;

    // `align` cannot be applied per-run — PDFKit would align each fragment
    // separately and scatter them across the line. Measure the whole string
    // instead and convert the alignment into an explicit start position.
    let startX = x;
    if (align && width !== undefined) {
      const total = runs.reduce((sum, run) => {
        doc.font(fontFor(run.gujarati));
        return sum + doc.widthOfString(run.text);
      }, 0);
      const base = x !== undefined ? x : doc.x;
      if (align === 'right') startX = base + Math.max(0, width - total);
      else if (align === 'center') startX = base + Math.max(0, (width - total) / 2);
      else startX = base;
    }

    const startY = y !== undefined ? y : doc.y;

    // Drawing at an explicit x moves PDFKit's left margin for subsequent
    // lines; remember it so plain doc.text() calls afterwards are not
    // indented by however far this line happened to start.
    const previousX = doc.x;

    runs.forEach((run, i) => {
      const isLast = i === runs.length - 1;
      // Inner fragments must not wrap or the line would break mid-word; the
      // final fragment keeps normal behaviour so the cursor advances to the
      // next line as callers expect.
      const runOpts = isLast
        ? { ...rest }
        : { ...rest, continued: true, lineBreak: false };
      doc.font(fontFor(run.gujarati));
      if (i === 0 && startX !== undefined) {
        doc.text(run.text, startX, startY, runOpts);
      } else {
        doc.text(run.text, runOpts);
      }
    });

    doc.x = previousX;
  };

  return {
    doc,
    unicode,
    writeText,
    setBold,
    regularFont: names.latinRegular,
    boldFont: names.latinBold,
    gujaratiFont: names.gujaratiRegular,
  };
}

/**
 * Format money for PDF output.
 * The rupee sign lives in the Gujarati subset, so it is only safe to emit when
 * those fonts loaded; otherwise fall back to "Rs.".
 */
function pdfMoney(amount, symbol = '₹', unicode = true) {
  const n = Number(amount) || 0;
  const safeSymbol = unicode ? symbol : String(symbol).replace(/₹/g, 'Rs.');
  return `${safeSymbol}${n.toFixed(2)}`;
}

/**
 * Render signature image (if uploaded) and "Authorised Signatory" label in PDF footers.
 */
function renderSignature(doc, writeText, setBold, company, yPos) {
  let y = yPos || (doc.y + 30);
  if (y > 700) { doc.addPage(); y = 50; }

  const sigPath = company?.signature_path;
  const config = require('../config');
  const path = require('path');
  const fs = require('fs');
  const sigFile = sigPath ? path.join(config.uploadDir, String(sigPath).replace(/^\/uploads\//, '')) : null;
  let textY = y;
  if (sigFile && fs.existsSync(sigFile)) {
    try {
      doc.image(sigFile, 385, y - 10, { fit: [140, 50], align: 'right' });
      textY = y + 45;
    } catch {
      // ignore unsupported image format
    }
  }
  setBold(true);
  writeText('Authorised Signatory', { x: 380, y: textY, width: 165, align: 'right' });
  setBold(false);
}

module.exports = { createPdfDocument, pdfMoney, splitByScript, renderSignature };
