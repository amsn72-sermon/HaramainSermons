// كاتب ملف Excel (.xlsx) بسيط بلا مكتبات: ZIP بلا ضغط + أوراق بنصوص مضمّنة.
// يكفي لتصدير جداول البيانات، ويفتح في Excel وNumbers وLibreOffice بلا تحذير.

const enc = new TextEncoder();

// جدول CRC32 يُبنى مرة واحدة
let TABLE = null;
function crcTable() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}
function crc32(bytes) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP بلا ضغط (store) — أبسط ما يقبله Excel
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); local.setUint16(6, 0, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true); cen.setUint16(14, 0, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, 0, true); cen.setUint16(32, 0, true);
    cen.setUint16(34, 0, true); cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const colName = i => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

// rows: مصفوفة صفوف، كل صف مصفوفة قيم نصية. أول صف رؤوس الأعمدة.
export function buildXlsx(rows, { sheetName = 'البيانات', rtl = true, allText = false } = {}) {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      // أرقام الهوية والجوال نصوص لا أعداد، فلا تفقد أصفارها ولا تتحول لصيغة علمية
      const num = !allText && v !== '' && v !== null && v !== undefined && /^-?\d{1,9}(\.\d+)?$/.test(String(v).trim());
      return num
        ? `<c r="${ref}"><v>${esc(v)}</v></c>`
        : `<c r="${ref}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  const widths = (rows[0] || []).map((_, c) => {
    const w = Math.min(46, Math.max(12, ...rows.map(r => String(r[c] ?? '').length + 4)));
    return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
  }).join('');

  const files = [
    ['[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets><sheet name="${esc(sheetName).slice(0, 30)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml',
      `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
      + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
      + `<fill><patternFill patternType="solid"><fgColor rgb="FFF1E9DD"/><bgColor indexed="64"/></patternFill></fill></fills>`
      + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
      + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ['xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}/></sheetViews>`
      + (widths ? `<cols>${widths}</cols>` : '')
      + `<sheetData>${body}</sheetData></worksheet>`]
  ];
  return zip(files);
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------------
// قارئ ملف Excel: يفكّ ZIP ويقرأ أول ورقة — بلا مكتبات (ملاحظة ١٥٨)
// يُستعمل لاستيراد الدليل المصطلحي، ويقبل CSV كذلك.
// ---------------------------------------------------------------------
const dec = new TextDecoder();

// إدخالات ZIP من الفهرس المركزي: الاسم ← البايتات (مفكوكة الضغط)
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // نهاية الفهرس المركزي: توقيعها في آخر ٦٦ كيلوبايت
  let end = -1;
  for (let i = dv.byteLength - 22; i >= Math.max(0, dv.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('الملف ليس ملف Excel صالحًا');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    // ترويسة السجل المحلي: طولها يختلف عن المركزي
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(start, start + size);
    out.set(name, { method, raw });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async name => {
    const e = out.get(name);
    if (!e) return null;
    if (e.method === 0) return dec.decode(e.raw);
    if (typeof DecompressionStream === 'undefined') throw new Error('متصفحك لا يفكّ ضغط الملف — احفظ الملف بصيغة CSV وجرّب مرة أخرى');
    const ds = new DecompressionStream('deflate-raw');
    const blob = new Blob([e.raw]).stream().pipeThrough(ds);
    return dec.decode(await new Response(blob).arrayBuffer());
  };
  return { names: [...out.keys()], read };
}

const colIndex = ref => {
  let n = 0;
  for (const ch of String(ref).replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// نصّ CSV ← صفوف (يحترم علامات الاقتباس)
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim()));
}

// ملف ← صفوف نصية. يقبل .xlsx و .csv
export async function readSheet(file) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text());

  const { names, read } = await unzip(await file.arrayBuffer());
  const sheetName = names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('لم تُوجد ورقة بيانات في الملف');
  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = [];
  if (sharedXml) {
    const doc = new DOMParser().parseFromString(sharedXml, 'application/xml');
    for (const si of doc.getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
    }
  }
  const doc = new DOMParser().parseFromString(await read(sheetName), 'application/xml');
  const rows = [];
  for (const r of doc.getElementsByTagName('row')) {
    const cells = [];
    for (const c of r.getElementsByTagName('c')) {
      const at = colIndex(c.getAttribute('r') || '');
      const type = c.getAttribute('t');
      let v = '';
      if (type === 's') {
        const idx = Number(c.getElementsByTagName('v')[0]?.textContent || -1);
        v = shared[idx] ?? '';
      } else if (type === 'inlineStr') {
        v = [...c.getElementsByTagName('t')].map(t => t.textContent).join('');
      } else {
        v = c.getElementsByTagName('v')[0]?.textContent || '';
      }
      cells[at >= 0 ? at : cells.length] = v;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows.filter(r => r.some(v => String(v).trim()));
}
