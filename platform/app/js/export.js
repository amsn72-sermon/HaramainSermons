// تصدير الترجمة على كليشة الهيئة مع بطاقة البيانات الثابتة:
// Word (.docx) عبر مكتبة docx المحلية، وPDF عبر طباعة المتصفح. المقاسات من page.js.
import { h } from './ui.js';
import { sanitize } from './sanitize.js';
import { langDir } from './store.js';
import { PAGE, LETTERHEAD, cardColumns, fileName } from './page.js';

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
  const cols = cardColumns(material, track.language_code, khateeb);
  const cell = (children, shading) => new TableCell({
    borders: { top: b, bottom: b, left: b, right: b },
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    shading: shading ? { fill: 'F6EFE3' } : undefined, children
  });
  const para = (text, o) => new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, children: [run(text, o)] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true,
    rows: [
      new TableRow({ tableHeader: true, children: cols.map(([k]) => cell([para(k, { bold: true, color: '8A6835' })], true)) }),
      new TableRow({ children: cols.map(([, v]) => cell([para(v)])) })
    ]
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

// الطباعة / الحفظ PDF: نقسّم النص إلى صفحات A4 بأنفسنا، ولكل صفحة كليشتها.
// لا نعتمد على تكرار المتصفح للعناصر الثابتة ولا لرأس الجدول وتذييله،
// لأن سفاري لا يكرّرها فتضيع الكليشة ويركب النص على بيانات التواصل (ملاحظة ٣٨).
export function printTranslation({ material, track, khateeb }, { autoPrint = true } = {}) {
  const dir = langDir(track.language_code);
  const w = window.open('', '_blank');
  if (!w) return false;
  const P = PAGE;
  const BOX_H = P.h - P.top - P.bottom;      // ارتفاع صندوق الكتابة بالمليمتر
  const BOX_W = P.w - P.side * 2;
  const NUM_H = 8;                          // شريط رقم الصفحة أسفل صندوق الكتابة
  const WIN_H = BOX_H - NUM_H;
  w.document.write(`<!doctype html><html lang="${track.language_code}" dir="${dir}" data-theme="light"><head><meta charset="utf-8"><title></title>
<link rel="stylesheet" href="${location.origin}/css/app.css"><style>
@page { size: A4; margin: 0; }
html, body { margin: 0; background: #fff !important; color: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* فاصل قبل كل صفحة تالية لا بعد كل صفحة، وإلا أنتج المتصفح صفحة بيضاء بينها (ملاحظة ٤٨) */
.sheet { position: relative; width: ${P.w}mm; height: ${P.h}mm; overflow: hidden; background: #fff; }
.sheet + .sheet { break-before: page; page-break-before: always; }
.sheet img.lh { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.win { position: absolute; top: ${P.top}mm; inset-inline-start: ${P.side}mm; width: ${BOX_W}mm; height: ${WIN_H}mm; overflow: hidden; }
.pageno { position: absolute; top: ${P.top + WIN_H}mm; inset-inline-start: ${P.side}mm; width: ${BOX_W}mm; height: ${NUM_H}mm;
  display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #6b6257; letter-spacing: .5px; }
.flow { position: absolute; top: 0; inset-inline-start: 0; width: ${BOX_W}mm; }
.print-body { --pt: 1pt; font-size: 12pt; line-height: 1.8; }
.print-body .data-card { font-size: 11pt; }
#measure { position: absolute; visibility: hidden; top: -10000mm; inset-inline-start: 0; width: ${BOX_W}mm; }
@media screen { body { background: #d9d9d9 !important; } .sheet { margin: 16px auto; box-shadow: 0 2px 12px #0003; } }
@media print { .sheet { margin: 0; box-shadow: none; height: ${P.h - 0.5}mm; } }
</style></head><body><div id="pages"></div><div id="measure"><div class="print-body flow"><div class="card-slot"></div><div class="t"></div></div></div></body></html>`);
  w.document.close();
  const d = w.document;
  d.title = fileName(material, track.language_code, khateeb);

  // بطاقة البيانات: صفّان بعرض الصفحة
  const card = d.createElement('table');
  card.className = 'data-card'; card.dir = 'rtl'; card.lang = 'ar';
  const cols = cardColumns(material, track.language_code, khateeb);
  const thead = d.createElement('thead'), htr = d.createElement('tr');
  const tb = d.createElement('tbody'), vtr = d.createElement('tr');
  for (const [k, v] of cols) {
    const th = d.createElement('th'), td = d.createElement('td');
    th.textContent = k; td.textContent = v; htr.append(th); vtr.append(td);
  }
  thead.append(htr); tb.append(vtr); card.append(thead, tb);
  d.querySelector('.card-slot').replaceWith(card);
  d.querySelector('.t').innerHTML = sanitize(track.translation_html);

  // مواضع نهايات الأسطر: لا نقطع سطرًا بين صفحتين
  function lineBottoms(flow) {
    const top = flow.getBoundingClientRect().top;
    const out = [];
    const walk = d.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const r = d.createRange(); r.selectNodeContents(n);
      for (const rect of r.getClientRects()) if (rect.height) out.push(rect.bottom - top);
    }
    // العناصر بلا نص (صور، فواصل، خلايا فارغة) تُحسب بحوافها السفلى
    for (const el of flow.querySelectorAll('img, hr, tr, td, th, li, p, div')) {
      const rect = el.getBoundingClientRect();
      if (rect.height) out.push(rect.bottom - top);
    }
    return [...new Set(out.map(v => Math.round(v)))].sort((a, b) => a - b);
  }

  function paginate() {
    const measure = d.getElementById('measure');
    const flow = measure.querySelector('.flow');
    const probe = d.createElement('div');
    probe.style.cssText = `height:${WIN_H}mm;width:1px;position:absolute;visibility:hidden`;
    d.body.append(probe);
    const boxPx = probe.getBoundingClientRect().height;
    probe.remove();

    const bottoms = lineBottoms(flow);
    const total = Math.max(flow.getBoundingClientRect().height, bottoms.at(-1) || 0);
    const starts = [0];
    let guard = 0;
    while (starts.at(-1) + boxPx < total - 1 && guard++ < 200) {
      const start = starts.at(-1);
      const limit = start + boxPx;
      const fit = bottoms.filter(b => b > start + 1 && b <= limit + 0.5);
      // آخر سطر يكتمل داخل الصفحة، وإن لم يكتمل أي سطر قطعنا عند حد الصفحة
      starts.push(fit.length ? fit.at(-1) : limit);
    }

    const pages = d.getElementById('pages');
    const lhUrl = new URL(LETTERHEAD, location.origin).href;
    const nfmt = new Intl.NumberFormat('ar-SA-u-nu-arab');
    pages.replaceChildren(...starts.map((start, i) => {
      const img = d.createElement('img'); img.className = 'lh'; img.alt = ''; img.src = lhUrl;
      const clone = flow.cloneNode(true);
      clone.style.top = `${-start}px`;
      const win = d.createElement('div'); win.className = 'win'; win.append(clone);
      // ترقيم الصفحات أسفل صندوق الكتابة (ملاحظة ٤٩)
      const num = d.createElement('div'); num.className = 'pageno';
      num.textContent = `${nfmt.format(i + 1)} / ${nfmt.format(starts.length)}`;
      const sheet = d.createElement('div'); sheet.className = 'sheet'; sheet.append(img, win, num);
      return sheet;
    }));
    measure.remove();
  }

  const ready = async () => {
    try { await d.fonts?.ready; } catch { /* المتصفح لا يدعم fonts.ready */ }
    await new Promise(r => setTimeout(r, 120));
    paginate();
    if (autoPrint) setTimeout(() => w.print(), 400);
  };
  if (d.readyState === 'complete') ready(); else w.addEventListener('load', ready);
  return true;
}
