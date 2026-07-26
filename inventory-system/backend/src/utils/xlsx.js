/**
 * Minimal XLSX reader/writer built on Node's built-in zlib.
 *
 * The `xlsx` (SheetJS) npm package carries unpatched prototype-pollution and
 * ReDoS advisories, and `exceljs` pulls in a large vulnerable dependency tree.
 * An .xlsx file is just a ZIP of XML parts, and this project only needs flat
 * "first sheet, header row + data rows" support, so implementing that directly
 * removes the dependency and its CVEs entirely.
 *
 * Supported:
 *   - readSheet(buffer)  -> array of row objects keyed by the header row
 *   - writeSheet(rows, sheetName) -> Buffer containing a valid .xlsx
 *
 * Not supported (intentionally): formulas, styling, multiple sheets, charts.
 */
const zlib = require('zlib');

/* ------------------------------------------------------------------ *
 * CRC32
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ *
 * ZIP writing
 * ------------------------------------------------------------------ */

function zipEntry(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  // Only use compression when it actually helps.
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;

  return {
    name: nameBuf,
    method: useDeflate ? 8 : 0,
    crc: crc32(data),
    compressedSize: payload.length,
    uncompressedSize: data.length,
    payload,
  };
}

function buildZip(files) {
  const entries = files.map((f) => zipEntry(f.name, f.content));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const e of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // flags: UTF-8 names
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0x21, 12);        // mod date (1980-01-01)
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compressedSize, 18);
    local.writeUInt32LE(e.uncompressedSize, 22);
    local.writeUInt16LE(e.name.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length

    localParts.push(local, e.name, e.payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);     // flags
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compressedSize, 20);
    central.writeUInt32LE(e.uncompressedSize, 24);
    central.writeUInt16LE(e.name.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset

    centralParts.push(central, e.name);

    offset += local.length + e.name.length + e.payload.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, end]);
}

/* ------------------------------------------------------------------ *
 * ZIP reading
 * ------------------------------------------------------------------ */

function readZip(buffer) {
  // Locate the end-of-central-directory record (scanning back over any comment).
  let eocd = -1;
  const minPos = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid XLSX file (missing ZIP directory)');

  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.slice(pos + 46, pos + 46 + nameLen).toString('utf8');

    // Read the local header to find where the data actually starts.
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.slice(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) content = raw;
    else if (method === 8) content = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported ZIP compression method ${method}`);

    files.set(name, content);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ------------------------------------------------------------------ *
 * XML helpers
 * ------------------------------------------------------------------ */

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that are illegal in XML 1.0. The literal
    // control ranges are required here, so the lint rule is not applicable.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Convert a zero-based column index to a spreadsheet letter (0 -> A). */
function colName(index) {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Parse a cell reference like "BC12" into a zero-based column index. */
function colIndex(ref) {
  const letters = String(ref).replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Read the first worksheet of an .xlsx buffer.
 * Returns an array of objects keyed by the values in the first (header) row.
 */
function readSheet(buffer) {
  const files = readZip(buffer);

  // Shared strings table (cells with t="s" index into this).
  const shared = [];
  const sharedXml = files.get('xl/sharedStrings.xml');
  if (sharedXml) {
    const xml = sharedXml.toString('utf8');
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml))) {
      // Concatenate every <t> inside the <si> (rich text runs).
      const parts = [];
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(m[1]))) parts.push(decodeXml(t[1]));
      shared.push(parts.join(''));
    }
  }

  // Find the first worksheet part.
  let sheetXml = files.get('xl/worksheets/sheet1.xml');
  if (!sheetXml) {
    for (const [name, content] of files) {
      if (name.startsWith('xl/worksheets/') && name.endsWith('.xml')) { sheetXml = content; break; }
    }
  }
  if (!sheetXml) throw new Error('No worksheet found in XLSX file');

  const xml = sheetXml.toString('utf8');
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/i);
      const idx = refMatch ? colIndex(refMatch[1]) : cells.length;
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : 'n';

      let value = '';
      if (type === 'inlineStr') {
        const parts = [];
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(body))) parts.push(decodeXml(t[1]));
        value = parts.join('');
      } else {
        const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = vMatch ? decodeXml(vMatch[1]) : '';
        if (type === 's') {
          value = shared[Number(raw)] ?? '';
        } else if (type === 'b') {
          value = raw === '1';
        } else if (raw === '') {
          value = '';
        } else {
          const num = Number(raw);
          value = Number.isFinite(num) ? num : raw;
        }
      }
      cells[idx] = value;
    }
    rows.push(cells);
  }

  if (!rows.length) return [];

  const header = (rows[0] || []).map((h) => String(h ?? '').trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // Skip entirely blank rows.
    if (!row.some((c) => c !== undefined && c !== null && c !== '')) continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      const v = row[c];
      obj[header[c]] = v === undefined ? '' : v;
    }
    out.push(obj);
  }
  return out;
}

/**
 * Build an .xlsx buffer from an array of row objects.
 * Column order follows the union of keys, in first-seen order.
 */
function writeSheet(rows, sheetName = 'Sheet1') {
  const data = Array.isArray(rows) ? rows : [];
  const headers = [];
  for (const row of data) {
    for (const key of Object.keys(row || {})) {
      if (!headers.includes(key)) headers.push(key);
    }
  }

  // Excel limits sheet names to 31 chars and forbids : \ / ? * [ ]
  const safeName = String(sheetName).replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet1';

  // Build a shared string table so text is stored once.
  const sharedIndex = new Map();
  const sharedList = [];
  const internString = (s) => {
    if (sharedIndex.has(s)) return sharedIndex.get(s);
    const i = sharedList.length;
    sharedIndex.set(s, i);
    sharedList.push(s);
    return i;
  };

  const xmlRows = [];

  // Header row
  const headerCells = headers.map((h, c) =>
    `<c r="${colName(c)}1" t="s"><v>${internString(String(h))}</v></c>`
  ).join('');
  xmlRows.push(`<row r="1">${headerCells}</row>`);

  // Data rows
  data.forEach((row, r) => {
    const rowNum = r + 2;
    const cells = [];
    headers.forEach((h, c) => {
      let v = row ? row[h] : undefined;
      if (v === undefined || v === null || v === '') return;
      const ref = `${colName(c)}${rowNum}`;
      if (typeof v === 'number' && Number.isFinite(v)) {
        cells.push(`<c r="${ref}"><v>${v}</v></c>`);
      } else if (typeof v === 'boolean') {
        cells.push(`<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`);
      } else {
        if (typeof v === 'object') v = JSON.stringify(v);
        cells.push(`<c r="${ref}" t="s"><v>${internString(String(v))}</v></c>`);
      }
    });
    xmlRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
  });

  const lastCol = colName(Math.max(0, headers.length - 1));
  const dimension = `A1:${lastCol}${data.length + 1}`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${xmlRows.join('')}</sheetData>` +
    `</worksheet>`;

  const sharedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedList.length}" uniqueCount="${sharedList.length}">` +
    sharedList.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') +
    `</sst>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(safeName)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/sharedStrings.xml', content: sharedXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]);
}

module.exports = { readSheet, writeSheet };
