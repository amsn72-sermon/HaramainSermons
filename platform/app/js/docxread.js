// قراءةُ ملف Word في المتصفح: بلا مكتبةٍ ولا شبكة (ملاحظة ٣٠٥)
//
//   ملفُ .docx حقيقتُه ZIP فيه word/document.xml. نفكُّ الضغطَ بما في
//   المتصفح أصلًا (DecompressionStream) ثم نقرأ الفقراتِ فقرةً فقرةً:
//   نصُّها، وجرأةُ خطِّها، ومحاذاتُها، ونمطُها، وهل قُطعت قبلها صفحة.
//   وبهذا يُشقُّ المجمَّعُ السنويُّ عند صفحات العنوان إلى خطبٍ.
import { unzip } from './xlsx.js';
import { escapeHtml } from './ui.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const val = (el, name) => (el ? el.getAttributeNS(W, name) ?? el.getAttribute('w:' + name) : null);
const kid = (el, name) => el.getElementsByTagNameNS(W, name)[0] || null;
const kids = (el, name) => [...el.getElementsByTagNameNS(W, name)];

// ملفٌ ← فقراتُه: [{ text, html, bold, size, align, style, heading, breakBefore }]
export async function readDocxParagraphs(file) {
  let read;
  try {
    ({ read } = await unzip(await file.arrayBuffer()));
  } catch {
    throw new Error(`تعذّرت قراءةُ ${file.name} — تأكّد أنه ملفُ Word بصيغة .docx`);
  }
  const xml = await read('word/document.xml');
  if (!xml) throw new Error(`لم يُوجد متنٌ في ${file.name} — إن كان الملفُ بصيغة .doc القديمة فاحفظه .docx`);

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = kid(doc.documentElement, 'body') || doc.documentElement;
  const out = [];

  for (const p of kids(body, 'p')) {
    const pPr = kid(p, 'pPr');
    const style = pPr ? val(kid(pPr, 'pStyle'), 'val') || '' : '';
    const align = pPr ? val(kid(pPr, 'jc'), 'val') || '' : '';
    const bidi = !!(pPr && kid(pPr, 'bidi'));
    let breakBefore = !!(pPr && kid(pPr, 'pageBreakBefore'));

    const parts = [];          // قطعُ HTML
    const plain = [];
    let bold = 0, total = 0, size = 0;

    for (const r of kids(p, 'r')) {
      const rPr = kid(r, 'rPr');
      const b = !!(rPr && (kid(rPr, 'b') || kid(rPr, 'bCs')));
      const i = !!(rPr && (kid(rPr, 'i') || kid(rPr, 'iCs')));
      const u = !!(rPr && kid(rPr, 'u'));
      const sz = rPr ? Number(val(kid(rPr, 'sz'), 'val') || 0) / 2 : 0;
      if (sz) size = Math.max(size, sz);

      for (const br of kids(r, 'br')) {
        if (val(br, 'type') === 'page') { if (!plain.length) breakBefore = true; }
        else parts.push('<br>');
      }
      let t = '';
      for (const node of kids(r, 't')) t += node.textContent || '';
      if (kids(r, 'tab').length && !t) t = ' ';
      if (!t) continue;
      plain.push(t);
      total += t.length;
      if (b) bold += t.length;
      let html = escapeHtml(t);
      if (b) html = `<strong>${html}</strong>`;
      if (i) html = `<em>${html}</em>`;
      if (u) html = `<u>${html}</u>`;
      parts.push(html);
    }

    const text = plain.join('').replace(/\s+/g, ' ').trim();
    const heading = /^Heading|^Title|^عنوان/i.test(style);
    if (!text && !breakBefore) continue;
    out.push({
      text,
      html: text ? `<p${align === 'center' ? ' style="text-align:center"' : ''}>${parts.join('')}</p>` : '',
      bold: total > 0 && bold / total > 0.6,
      size, align, style, heading, bidi, breakBefore,
    });
  }
  return out;
}

export default readDocxParagraphs;
