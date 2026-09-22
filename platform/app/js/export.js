// تصدير الترجمة: Word (.docx) عبر مكتبة docx المحلية، وPDF عبر الطباعة
import { h, fmtSermonDate } from './ui.js';
import { sanitize } from './sanitize.js';
import { MOSQUE, langName, langDir } from './store.js';

let docxLoading = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  if (!docxLoading) docxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/docx.iife.js';
    s.onload = () => resolve(window.docx);
    s.onerror = () => reject(new Error('تعذّر تحميل أداة Word'));
    document.head.append(s);
  });
  return docxLoading;
}

// يحوّل HTML المنقّى إلى فقرات Word مع الحفاظ على العريض والمائل والتسطير والقوائم
function htmlToParagraphs(docx, html, rtl) {
  const { Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
  const root = new DOMParser().parseFromString(`<body>${sanitize(html)}</body>`, 'text/html').body;
  const paras = [];
  const runsOf = (node, style = {}) => {
    const runs = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent) runs.push(new TextRun({ text: n.textContent, bold: style.b, italics: style.i, underline: style.u ? {} : undefined, strike: style.s, rightToLeft: rtl, font: 'Arial', size: 26 })); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'BR') { runs.push(new TextRun({ break: 1 })); continue; }
      runs.push(...runsOf(n, { b: style.b || t === 'B' || t === 'STRONG', i: style.i || t === 'I' || t === 'EM', u: style.u || t === 'U', s: style.s || t === 'S' || t === 'STRIKE' }));
    }
    return runs;
  };
  const align = el => ({ center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[(el.style?.textAlign || el.getAttribute?.('align') || '').toLowerCase()];
  const block = (el, extra = {}) => paras.push(new Paragraph({ children: runsOf(el), bidirectional: rtl, alignment: align(el), spacing: { after: 160, line: 360 }, ...extra }));
  for (const n of root.childNodes) {
    if (n.nodeType === 3) { if (n.textContent.trim()) paras.push(new Paragraph({ children: [new TextRun({ text: n.textContent, rightToLeft: rtl, font: 'Arial', size: 26 })], bidirectional: rtl })); continue; }
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'H2') block(n, { heading: HeadingLevel.HEADING_2 });
    else if (n.tagName === 'H3') block(n, { heading: HeadingLevel.HEADING_3 });
    else if (n.tagName === 'UL' || n.tagName === 'OL') [...n.children].forEach((li, i) => block(li, n.tagName === 'UL' ? { bullet: { level: 0 } } : { children: [new TextRun({ text: `${i + 1}. `, rightToLeft: rtl }), ...runsOf(li)] }));
    else block(n);
  }
  return paras;
}

export async function downloadDocx({ material, track, khateeb }) {
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = docx;
  const rtl = langDir(track.language_code) === 'rtl';
  const meta = [
    material.title,
    [MOSQUE[material.mosque], khateeb, material.sermon_date && fmtSermonDate(material.sermon_date)].filter(Boolean).join(' — '),
    `الترجمة: ${langName(track.language_code)}`
  ];
  const doc = new Document({
    creator: 'منصة ترجمة خطب الحرمين الشريفين', title: material.title,
    sections: [{ children: [
      ...meta.map((t, i) => new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, spacing: { after: i === 2 ? 360 : 80 },
        children: [new TextRun({ text: t, bold: i === 0, size: i === 0 ? 32 : 24, rightToLeft: true, font: 'Arial' })] })),
      ...htmlToParagraphs(docx, track.translation_html, rtl)
    ] }]
  });
  const blob = await Packer.toBlob(doc);
  const a = h('a', { href: URL.createObjectURL(blob), download: `${material.title} - ${langName(track.language_code)}.docx` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// نسخة للطباعة أو الحفظ PDF من المتصفح
export function printTranslation({ material, track, khateeb }) {
  const dir = langDir(track.language_code);
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="${track.language_code}" dir="${dir}"><head><meta charset="utf-8"><title></title>
    <link rel="stylesheet" href="/css/app.css"><style>body{background:#fff;color:#000;padding:32px;max-width:800px;margin:auto}
    header{text-align:center;border-bottom:2px solid #bc9661;margin-bottom:24px;padding-bottom:12px} header img{height:64px}
    .t{line-height:1.9;font-size:13pt}</style></head><body><header dir="rtl"><img src="/assets/alharamain-logo.png" alt=""><h2></h2><p class="m"></p></header>
    <div class="t"></div></body></html>`);
  w.document.close();
  w.document.title = material.title;
  w.document.querySelector('h2').textContent = material.title;
  w.document.querySelector('.m').textContent = [MOSQUE[material.mosque], khateeb, material.sermon_date && fmtSermonDate(material.sermon_date), langName(track.language_code)].filter(Boolean).join(' — ');
  w.document.querySelector('.t').innerHTML = sanitize(track.translation_html);
  w.addEventListener('load', () => setTimeout(() => w.print(), 300));
  return true;
}
