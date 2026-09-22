// تصدير الترجمة على كليشة الهيئة مع بطاقة البيانات الثابتة:
// Word (.docx) عبر مكتبة docx المحلية، وPDF عبر طباعة المتصفح. المقاسات من page.js.
import { h } from './ui.js';
import { sanitize } from './sanitize.js';
import { langDir } from './store.js';
import { PAGE, LETTERHEAD, heading, cardRows, fileName } from './page.js';

let docxLoading = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  if (!docxLoading) docxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/docx.iife.js';
    s.onload = () => resolve(window.docx);
    s.onerror = () => { docxLoading = null; reject(new Error('تعذّر تحميل أداة Word')); };
    document.head.append(s);
  });
  return docxLoading;
}

const GOLD = 'BC9661';
const TW = mm => Math.round(mm * 1440 / 25.4);           // ملّيمتر → twip
const PX = mm => Math.round(mm * 96 / 25.4);             // ملّيمتر → بكسل (مكتبة docx)
const BASE_PT = 12;

// يحوّل HTML المنقّى إلى عناصر Word مع الحفاظ على التنسيق الأساسي والجداول
function htmlToBlocks(docx, html, rtl) {
  const { Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = docx;
  const root = new DOMParser().parseFromString(`<body>${sanitize(html)}</body>`, 'text/html').body;
  const out = [];
  const sizeOf = (el, parent) => {
    const fs = el.style?.fontSize;
    if (!fs) return parent;
    const n = parseFloat(fs);
    if (fs.endsWith('em')) return parent * n;
    if (fs.endsWith('pt')) return n;
    if (fs.endsWith('px')) return n * 0.75;
    return parent;
  };
  const runsOf = (node, st) => {
    const runs = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        if (n.textContent) runs.push(new TextRun({ text: n.textContent, bold: st.b, italics: st.i, underline: st.u ? {} : undefined, strike: st.s,
          superScript: st.sup, subScript: st.sub, rightToLeft: rtl, font: st.font || 'Arial', size: Math.round(st.pt * 2), color: st.color }));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'BR') { runs.push(new TextRun({ break: 1 })); continue; }
      const color = (n.style?.color || n.getAttribute?.('color') || '').trim();
      const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1] || (/^#([0-9a-f]{3})$/i.exec(color)?.[1] || '').replace(/./g, c => c + c) || null;
      runs.push(...runsOf(n, { ...st,
        b: st.b || t === 'B' || t === 'STRONG' || /bold|[6-9]00/.test(n.style?.fontWeight || ''),
        i: st.i || t === 'I' || t === 'EM', u: st.u || t === 'U', s: st.s || t === 'S' || t === 'STRIKE',
        sup: st.sup || t === 'SUP', sub: st.sub || t === 'SUB',
        font: n.getAttribute?.('face') || (n.style?.fontFamily || '').replace(/["']/g, '').split(',')[0] || st.font,
        pt: sizeOf(n, st.pt), color: hex || st.color }));
    }
    return runs;
  };
  const align = el => ({ center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[(el.style?.textAlign || el.getAttribute?.('align') || '').toLowerCase()];
  const lineOf = el => Math.round(240 * (parseFloat(el.style?.lineHeight) || 1.8));
  const para = (el, extra = {}, st = {}) => new Paragraph({ children: runsOf(el, { pt: BASE_PT, ...st }), bidirectional: rtl, alignment: align(el),
    spacing: { after: 120, line: lineOf(el) }, ...extra });
  const border = { style: BorderStyle.SINGLE, size: 4, color: '888888' };
  const table = el => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: rtl,
    rows: [...el.querySelectorAll('tr')].map(tr => new TableRow({ children: [...tr.children].map(td => new TableCell({
      columnSpan: Number(td.getAttribute('colspan')) || undefined,
      borders: { top: border, bottom: border, left: border, right: border },
      children: [para(td, { spacing: { after: 0 } }, { b: td.tagName === 'TH' })] })) }))
  });
  const walk = parent => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) out.push(new Paragraph({ children: [new TextRun({ text: n.textContent, rightToLeft: rtl, font: 'Arial', size: BASE_PT * 2 })], bidirectional: rtl })); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'H2') out.push(para(n, { heading: HeadingLevel.HEADING_2 }, { pt: BASE_PT * 1.35, b: true }));
      else if (t === 'H3') out.push(para(n, { heading: HeadingLevel.HEADING_3 }, { pt: BASE_PT * 1.15, b: true }));
      else if (t === 'UL' || t === 'OL') [...n.children].forEach((li, i) => out.push(t === 'UL' ? para(li, { bullet: { level: 0 } })
        : new Paragraph({ bidirectional: rtl, spacing: { after: 120, line: lineOf(li) }, children: [new TextRun({ text: `${i + 1}. `, rightToLeft: rtl, size: BASE_PT * 2 }), ...runsOf(li, { pt: BASE_PT })] })));
      else if (t === 'TABLE') out.push(table(n), new Paragraph({ children: [] }));
      else if (t === 'HR') out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD } } }));
      else if (t === 'DIV' && [...n.children].some(c => /^(P|DIV|H2|H3|UL|OL|TABLE|BLOCKQUOTE)$/.test(c.tagName))) walk(n);
      else if (t === 'BLOCKQUOTE') out.push(para(n, { indent: { start: TW(10), end: TW(10) } }));
      else out.push(para(n));
    }
  };
  walk(root);
  return out;
}

function cardTable(docx, material, track, khateeb) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = docx;
  const b = { style: BorderStyle.SINGLE, size: 8, color: GOLD };
  const run = (text, o = {}) => new TextRun({ text, rightToLeft: true, font: 'Arial', size: 22, ...o });
  const rows = cardRows(material, track.language_code, khateeb);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true,
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: b, bottom: b, left: b, right: b },
      margins: { top: 80, bottom: 80, left: 160, right: 160 },
      children: [
        new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 60 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 2 } },
          children: [run(heading(material), { bold: true, size: 26, color: '9A7443' })] }),
        ...rows.map(([k, v]) => new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 20 },
          children: [run(`${k}: `, { bold: true, color: '9A7443' }), run(v)] }))
      ] })] })]
  });
}

export async function downloadDocx({ material, track, khateeb }) {
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, ImageRun, Header, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom } = docx;
  const rtl = langDir(track.language_code) === 'rtl';
  const img = await fetch(LETTERHEAD).then(r => { if (!r.ok) throw new Error('تعذّر تحميل الكليشة'); return r.arrayBuffer(); });
  const letterhead = new Paragraph({ children: [new ImageRun({
    type: 'jpg', data: img, transformation: { width: PX(PAGE.w), height: PX(PAGE.h) },
    floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true }
  })] });
  const doc = new Document({
    creator: 'منصة ترجمة خطب الحرمين الشريفين', title: fileName(material, track.language_code, khateeb),
    sections: [{
      properties: { page: { size: { width: TW(PAGE.w), height: TW(PAGE.h) },
        margin: { top: TW(PAGE.top), bottom: TW(PAGE.bottom), left: TW(PAGE.side), right: TW(PAGE.side), header: 0, footer: 0 } } },
      headers: { default: new Header({ children: [letterhead] }) },
      children: [cardTable(docx, material, track, khateeb), new Paragraph({ children: [], spacing: { after: 200 } }),
        ...htmlToBlocks(docx, track.translation_html, rtl)]
    }]
  });
  const blob = await Packer.toBlob(doc);
  const a = h('a', { href: URL.createObjectURL(blob), download: `${fileName(material, track.language_code, khateeb)}.docx` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// الطباعة / الحفظ PDF: الكليشة خلف كل صفحة، وصندوق الكتابة بنفس مقاسات المحرر
export function printTranslation({ material, track, khateeb }, { autoPrint = true } = {}) {
  const dir = langDir(track.language_code);
  const w = window.open('', '_blank');
  if (!w) return false;
  const P = PAGE;
  w.document.write(`<!doctype html><html lang="${track.language_code}" dir="${dir}" data-theme="light"><head><meta charset="utf-8"><title></title>
<link rel="stylesheet" href="/css/app.css"><style>
@page { size: A4; margin: 0; }
html, body { margin: 0; background: #fff !important; color: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
img.lh { position: fixed; top: 0; left: 0; width: ${P.w}mm; height: ${P.h}mm; z-index: -1; }
table.frame { width: ${P.w}mm; border-collapse: collapse; }
table.frame > thead td { height: ${P.top}mm; padding: 0; } table.frame > tfoot td { height: ${P.bottom}mm; padding: 0; }
table.frame > tbody > tr > td { padding: 0 ${P.side}mm; vertical-align: top; }
.print-body { --pt: 1pt; font-size: 12pt; line-height: 1.8; }
.print-body .data-card { font-size: 11pt; }
@media screen { body { background: #d9d9d9 !important; } .sheet { width: ${P.w}mm; min-height: ${P.h}mm; margin: 16px auto; background: #fff; position: relative; box-shadow: 0 2px 12px #0003; } img.lh { position: absolute; } }
</style></head><body><div class="sheet"><img class="lh" alt=""><table class="frame"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot>
<tbody><tr><td><div class="print-body"><div class="card-slot"></div><div class="t"></div></div></td></tr></tbody></table></div></body></html>`);
  w.document.close();
  const d = w.document;
  d.title = fileName(material, track.language_code, khateeb);
  d.querySelector('img.lh').src = LETTERHEAD;
  const card = d.createElement('div');
  card.className = 'data-card'; card.dir = 'rtl'; card.lang = 'ar';
  const head = d.createElement('div'); head.className = 'dc-head'; head.textContent = heading(material);
  const dl = d.createElement('dl');
  for (const [k, v] of cardRows(material, track.language_code, khateeb)) {
    const row = d.createElement('div'), dt = d.createElement('dt'), dd = d.createElement('dd');
    dt.textContent = k; dd.textContent = v; row.append(dt, dd); dl.append(row);
  }
  card.append(head, dl);
  d.querySelector('.card-slot').replaceWith(card);
  d.querySelector('.t').innerHTML = sanitize(track.translation_html);
  const go = () => setTimeout(() => w.print(), 400);
  if (autoPrint) { if (d.readyState === 'complete') go(); else w.addEventListener('load', go); }
  return true;
}
