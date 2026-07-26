#!/usr/bin/env node
/**
 * Convert the packaged WOFF fonts to TTF for PDF embedding.
 *
 * PDFKit can parse a WOFF header but does not inflate the per-table
 * compression WOFF applies, so embedding one directly yields a PDF whose
 * glyphs render as empty boxes. A WOFF file is just an SFNT (TTF) with each
 * table zlib-compressed, so rebuilding the plain SFNT is a small, dependency
 * free transformation.
 *
 * Run automatically via `npm run postinstall`; output goes to
 * `backend/assets/fonts/` which is git-ignored.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SUBSETS = [
  ['gujarati', 400], ['gujarati', 700],
  ['latin', 400], ['latin', 700],
];

function findSourceDir() {
  const candidates = [
    path.join(__dirname, '../node_modules/@fontsource/noto-sans-gujarati/files'),
    path.join(process.cwd(), 'node_modules/@fontsource/noto-sans-gujarati/files'),
  ];
  return candidates.find((d) => fs.existsSync(d)) || null;
}

/**
 * Rewrite the `name` table so each subset carries a unique family and
 * PostScript name.
 *
 * Every Noto subset ships with the identical internal name
 * ("NotoSansGujarati-Regular"). Embedding two of them in one PDF makes
 * viewers treat the second as a duplicate of the first, so text drawn with
 * the Gujarati subset gets rendered using the Latin font's glyph set and
 * appears as empty boxes. Giving each file a distinct name avoids the clash.
 */
function renameFont(sfnt, suffix) {
  const numTables = sfnt.readUInt16BE(4);

  let nameOffset = null;
  let nameLength = null;
  let dirPos = null;
  for (let i = 0; i < numTables; i++) {
    const pos = 12 + i * 16;
    if (sfnt.slice(pos, pos + 4).toString('ascii') === 'name') {
      dirPos = pos;
      nameOffset = sfnt.readUInt32BE(pos + 8);
      nameLength = sfnt.readUInt32BE(pos + 12);
      break;
    }
  }
  if (nameOffset === null) return sfnt;

  const table = sfnt.slice(nameOffset, nameOffset + nameLength);
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);

  // Name IDs that identify the font to a PDF consumer.
  const TARGET_IDS = new Set([1, 3, 4, 6]);

  const records = [];
  for (let i = 0; i < count; i++) {
    const pos = 6 + i * 12;
    records.push({
      platformID: table.readUInt16BE(pos),
      encodingID: table.readUInt16BE(pos + 2),
      languageID: table.readUInt16BE(pos + 4),
      nameID: table.readUInt16BE(pos + 6),
      length: table.readUInt16BE(pos + 8),
      offset: table.readUInt16BE(pos + 10),
    });
  }

  // Rebuild the string storage, appending the suffix to the target records.
  const strings = [];
  let cursor = 0;
  for (const r of records) {
    const raw = table.slice(stringOffset + r.offset, stringOffset + r.offset + r.length);
    let value = raw;
    if (TARGET_IDS.has(r.nameID)) {
      const isUtf16 = r.platformID === 0 || r.platformID === 3;
      const text = isUtf16 ? raw.toString('utf16le').replace(/\0/g, '') : raw.toString('latin1');
      // UTF-16BE in the file: decode big-endian by swapping.
      const decoded = isUtf16 ? raw.swap16().toString('utf16le') : text;
      const updated = decoded + suffix;
      value = isUtf16
        ? Buffer.from(updated, 'utf16le').swap16()
        : Buffer.from(updated, 'latin1');
    }
    r.newOffset = cursor;
    r.newLength = value.length;
    strings.push(value);
    cursor += value.length;
  }

  const storage = Buffer.concat(strings);
  const newTable = Buffer.alloc(6 + count * 12 + storage.length);
  newTable.writeUInt16BE(0, 0);
  newTable.writeUInt16BE(count, 2);
  newTable.writeUInt16BE(6 + count * 12, 4);
  records.forEach((r, i) => {
    const pos = 6 + i * 12;
    newTable.writeUInt16BE(r.platformID, pos);
    newTable.writeUInt16BE(r.encodingID, pos + 2);
    newTable.writeUInt16BE(r.languageID, pos + 4);
    newTable.writeUInt16BE(r.nameID, pos + 6);
    newTable.writeUInt16BE(r.newLength, pos + 8);
    newTable.writeUInt16BE(r.newOffset, pos + 10);
  });
  storage.copy(newTable, 6 + count * 12);

  // Reassemble the font with the resized name table, keeping tables in order.
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const pos = 12 + i * 16;
    const tag = sfnt.slice(pos, pos + 4);
    const checksum = sfnt.readUInt32BE(pos + 4);
    const offset = sfnt.readUInt32BE(pos + 8);
    const length = sfnt.readUInt32BE(pos + 12);
    const isName = pos === dirPos;
    tables.push({
      tag,
      checksum,
      data: isName ? newTable : sfnt.slice(offset, offset + length),
    });
  }

  const header = sfnt.slice(0, 12);
  const directory = Buffer.alloc(numTables * 16);
  const body = [];
  let offset = 12 + numTables * 16;

  tables.forEach((t, i) => {
    const pos = i * 16;
    t.tag.copy(directory, pos);
    directory.writeUInt32BE(t.checksum, pos + 4);
    directory.writeUInt32BE(offset, pos + 8);
    directory.writeUInt32BE(t.data.length, pos + 12);
    body.push(t.data);
    const pad = (4 - (t.data.length % 4)) % 4;
    if (pad) body.push(Buffer.alloc(pad));
    offset += t.data.length + pad;
  });

  return Buffer.concat([header, directory, ...body]);
}

/** Decode a WOFF buffer into an uncompressed SFNT (TTF) buffer. */
function woffToSfnt(woff) {
  if (woff.slice(0, 4).toString('ascii') !== 'wOFF') {
    throw new Error('not a WOFF file');
  }

  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  // Parse the WOFF table directory.
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const off = 44 + i * 20;
    entries.push({
      tag: woff.slice(off, off + 4),
      offset: woff.readUInt32BE(off + 4),
      compLength: woff.readUInt32BE(off + 8),
      origLength: woff.readUInt32BE(off + 12),
      origChecksum: woff.readUInt32BE(off + 16),
    });
  }

  // Inflate each table (compLength === origLength means it was stored raw).
  for (const e of entries) {
    const raw = woff.slice(e.offset, e.offset + e.compLength);
    e.data = e.compLength === e.origLength ? raw : zlib.inflateSync(raw);
    if (e.data.length !== e.origLength) {
      throw new Error(`table ${e.tag.toString('ascii')} length mismatch`);
    }
  }

  // SFNT requires tables sorted by tag.
  entries.sort((a, b) => a.tag.compare(b.tag));

  // Build the SFNT header.
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16;
  const entrySelector = Math.floor(Math.log2(numTables));
  const rangeShift = numTables * 16 - searchRange;

  const header = Buffer.alloc(12);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(rangeShift, 10);

  const directory = Buffer.alloc(numTables * 16);
  const body = [];
  let offset = 12 + numTables * 16;

  entries.forEach((e, i) => {
    const pos = i * 16;
    e.tag.copy(directory, pos);
    directory.writeUInt32BE(e.origChecksum, pos + 4);
    directory.writeUInt32BE(offset, pos + 8);
    directory.writeUInt32BE(e.origLength, pos + 12);

    body.push(e.data);
    // Tables are padded to a 4-byte boundary.
    const pad = (4 - (e.origLength % 4)) % 4;
    if (pad) body.push(Buffer.alloc(pad));
    offset += e.origLength + pad;
  });

  return Buffer.concat([header, directory, ...body]);
}

function main() {
  const srcDir = findSourceDir();
  if (!srcDir) {
    console.log('noto-sans-gujarati not installed; skipping font build.');
    return;
  }

  const outDir = path.join(__dirname, '../assets/fonts');
  fs.mkdirSync(outDir, { recursive: true });

  let built = 0;
  for (const [subset, weight] of SUBSETS) {
    const src = path.join(srcDir, `noto-sans-gujarati-${subset}-${weight}-normal.woff`);
    const dest = path.join(outDir, `noto-${subset}-${weight}.ttf`);
    if (!fs.existsSync(src)) continue;

    try {
      let ttf = woffToSfnt(fs.readFileSync(src));
      // Distinct internal names so both subsets can coexist in one PDF.
      ttf = renameFont(ttf, `-${subset}`);
      fs.writeFileSync(dest, ttf);
      built++;
    } catch (err) {
      console.warn(`  ! ${subset}-${weight}: ${err.message}`);
    }
  }
  console.log(`Fonts: built ${built} TTF file(s) in assets/fonts`);
}

if (require.main === module) main();

module.exports = { woffToSfnt, renameFont };
