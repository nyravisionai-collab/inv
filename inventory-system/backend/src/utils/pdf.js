/**
 * PDF helpers.
 *
 * PDFKit's built-in Helvetica is a WinAnsi font: it cannot render Gujarati and
 * it has no rupee glyph. When the Noto Sans Gujarati package is installed we
 * register it and use it for the whole document, so bilingual invoices and
 * ₹ amounts print correctly. If the font is missing we degrade gracefully to
 * Helvetica with an ASCII currency fallback rather than failing the download.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_CANDIDATES = [
  '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff',
  '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-all-400-normal.woff',
];
const BOLD_CANDIDATES = [
  '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-700-normal.woff',
  '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-all-700-normal.woff',
];

const NODE_MODULES_ROOTS = [
  path.join(__dirname, '../../node_modules'),
  path.join(process.cwd(), 'node_modules'),
];

function resolveFont(candidates) {
  for (const root of NODE_MODULES_ROOTS) {
    for (const rel of candidates) {
      const full = path.join(root, rel);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

let cached = null;

function loadFonts() {
  if (cached) return cached;
  const regularPath = resolveFont(FONT_CANDIDATES);
  const boldPath = resolveFont(BOLD_CANDIDATES);
  cached = {
    regular: regularPath ? fs.readFileSync(regularPath) : null,
    bold: boldPath ? fs.readFileSync(boldPath) : null,
  };
  return cached;
}

/**
 * Create a PDFDocument with Unicode fonts registered.
 * The returned object exposes `regularFont` / `boldFont` names to use with
 * `doc.font(...)`, plus `unicode` telling callers whether ₹ is safe to emit.
 */
function createPdfDocument(options = {}) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', ...options });
  const fonts = loadFonts();

  let regularFont = 'Helvetica';
  let boldFont = 'Helvetica-Bold';
  let unicode = false;

  if (fonts.regular) {
    try {
      doc.registerFont('AppRegular', fonts.regular);
      regularFont = 'AppRegular';
      unicode = true;
      if (fonts.bold) {
        doc.registerFont('AppBold', fonts.bold);
        boldFont = 'AppBold';
      } else {
        boldFont = 'AppRegular';
      }
      doc.font(regularFont);
    } catch {
      regularFont = 'Helvetica';
      boldFont = 'Helvetica-Bold';
      unicode = false;
    }
  }

  return { doc, regularFont, boldFont, unicode };
}

/**
 * Format a money amount for PDF output.
 * Falls back to "Rs." when the document cannot render the ₹ glyph.
 */
function pdfMoney(amount, symbol = '₹', unicode = true) {
  const n = Number(amount) || 0;
  const safeSymbol = unicode ? symbol : symbol.replace(/₹/g, 'Rs.');
  return `${safeSymbol}${n.toFixed(2)}`;
}

module.exports = { createPdfDocument, pdfMoney };
