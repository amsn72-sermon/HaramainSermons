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

// ورقةٌ واحدة ← جسدُ الصفوف وأعمدتُها
function sheetXml(rows, { rtl = true, allText = false } = {}) {
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

  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}/></sheetViews>`
    + (widths ? `<cols>${widths}</cols>` : '')
    + `<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
  + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
  + `<fill><patternFill patternType="solid"><fgColor rgb="FFF1E9DD"/><bgColor indexed="64"/></patternFill></fill></fills>`
  + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
  + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// اسمُ ورقةٍ مقبولٌ في Excel: ٣١ محرفًا، وبلا المحارف الممنوعة
const sheetSafe = (name, i) => (String(name || '').replace(/[\\/?*[\]:]/g, ' ').trim()
  .slice(0, 31) || `ورقة ${i + 1}`);

// مصنَّفٌ بعدّة أوراق (ملاحظة ٢٤٥): [{ name, rows }]
export function buildXlsxBook(sheets, { rtl = true, allText = false } = {}) {
  const list = (sheets || []).filter(s => s && Array.isArray(s.rows));
  if (!list.length) throw new Error('لا أوراق في المصنَّف');
  const names = [];
  list.forEach((s, i) => {
    let n = sheetSafe(s.name, i);
    let k = 2;
    while (names.includes(n)) n = `${n.slice(0, 28)} ${k++}`;
    names.push(n);
  });

  const files = [
    ['[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
        + `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
      + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + `</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + list.map((_, i) => `<Relationship Id="rId${i + 1}" `
        + `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" `
        + `Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${list.length + 1}" `
      + `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...list.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, { rtl, allText })])
  ];
  return zip(files);
}

// rows: مصفوفة صفوف، كل صف مصفوفة قيم نصية. أول صف رؤوس الأعمدة.
export function buildXlsx(rows, { sheetName = 'البيانات', rtl = true, allText = false } = {}) {
  return buildXlsxBook([{ name: sheetName, rows }], { rtl, allText });
}


// حزمةُ ملفاتٍ للتنزيل: نصوصٌ أو بياناتٌ خام، بلا ضغطٍ كما في ملفات Excel
// (ملاحظة ٢٣٧). الأسماءُ بالعربية، فيُعلَّم بأن الاسم بـUTF-8.
export function zipFiles(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const data = content instanceof Uint8Array ? content : enc.encode(String(content));
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
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
    { type: 'application/zip' });
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

const rowsOf = (xml, shared) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
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
      } else if (type === 'inlineStr' || type === 'str') {
        v = [...c.getElementsByTagName('t')].map(t => t.textContent).join('')
          || c.getElementsByTagName('v')[0]?.textContent || '';
      } else {
        v = c.getElementsByTagName('v')[0]?.textContent || '';
      }
      cells[at >= 0 ? at : cells.length] = v;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows.filter(r => r.some(v => String(v).trim()));
};

// ملف ← أوراقُه كلُّها بأسمائها (ملاحظة ٢٤٤): [{ name, rows }]
//   فالقواميسُ تأتي ورقةً لكلِّ لغة، واسمُ الورقة هو ما يدلّ على لسانها.
export async function readWorkbook(file) {
  const fname = String(file.name || '').toLowerCase();
  if (fname.endsWith('.csv') || fname.endsWith('.txt')) {
    return [{ name: String(file.name || 'CSV').replace(/\.[^.]+$/, ''), rows: parseCsv(await file.text()) }];
  }

  const { names, read } = await unzip(await file.arrayBuffer());
  const parts = names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => (Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1])));
  if (!parts.length) throw new Error('لم تُوجد ورقة بيانات في الملف');

  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = [];
  if (sharedXml) {
    const doc = new DOMParser().parseFromString(sharedXml, 'application/xml');
    for (const si of doc.getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
    }
  }

  // أسماءُ الأوراق: workbook.xml يربط الاسمَ بـ rId، والعلاقاتُ تربط rId بالملف
  const titles = new Map();           // اسمُ ملفِ الورقة ← اسمُها المعروض
  try {
    const wb = new DOMParser().parseFromString(await read('xl/workbook.xml'), 'application/xml');
    const rels = new DOMParser().parseFromString(await read('xl/_rels/workbook.xml.rels'), 'application/xml');
    const target = new Map();
    for (const rel of rels.getElementsByTagName('Relationship')) {
      target.set(rel.getAttribute('Id'), String(rel.getAttribute('Target') || '').replace(/^\/?xl\//, ''));
    }
    for (const sh of wb.getElementsByTagName('sheet')) {
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS?.(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const t = target.get(rid);
      if (t) titles.set(`xl/${t.replace(/^\.?\//, '')}`, sh.getAttribute('name') || '');
    }
  } catch { /* بلا أسماء: نُسمّيها بالترتيب */ }

  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const xml = await read(parts[i]);
    if (!xml) continue;
    out.push({ name: titles.get(parts[i]) || `ورقة ${i + 1}`, rows: rowsOf(xml, shared) });
  }
  return out.filter(s => s.rows.length);
}

// ملف ← صفوف أول ورقة. يقبل .xlsx و .csv
export async function readSheet(file) {
  const book = await readWorkbook(file);
  return book[0]?.rows || [];
}
