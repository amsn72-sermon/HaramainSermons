// استخراجُ نصِّ الملف المرفوع: وورد وPDF (ملاحظة ٤٠٨)
//
//   كان الرفعُ يحفظ الملفَّ ولا يقرأ ما فيه، فتُفتَح الكليشةُ فارغةً
//   ويمتنع تصديرُ وورد وPDF لأنهما يُبنيان من النصِّ لا من الملف.
//   فيُقرأ الملفُّ في متصفِّح الرافع — لا يخرج إلى خدمةٍ خارجية —
//   ويُحفَظ نصُّه مع الملف.
//
//   ووورد يُقرأ بـ`docxread.js` القائمِ من قبل، وPDF بأداة pdfjs
//   المرفقةِ بالمنصة. وأمّا `.doc` القديمُ فثنائيٌّ لا يُقرأ، ويُقال ذلك.
import { readDocxParagraphs } from './docxread.js';
import { escapeHtml as esc } from './ui.js';

// ـــ وورد: فقراتُه نصًّا، وما كان عنوانًا يبقى فقرةً عريضة
export async function docxHtml(file) {
  const paras = await readDocxParagraphs(file);
  const out = [];
  for (const p of paras) {
    const t = String(p.text || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    out.push(p.heading || p.bold ? `<p><b>${esc(t)}</b></p>` : `<p>${esc(t)}</p>`);
  }
  if (!out.length) throw new Error('لا نصَّ في ملفِّ وورد — لعلَّه صورٌ.');
  return out.join('\n');
}

// ـــ PDF: نصُّ كلِّ صفحةٍ بسطوره، بأداة pdfjs المرفقة بالمنصة
export async function pdfHtml(file) {
  const lib = await import('/vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = [];
    let lastY = null;
    const flush = () => {
      const t = line.join('').replace(/\s+/g, ' ').trim();
      if (t) out.push(`<p>${esc(t)}</p>`);
      line = [];
    };
    for (const it of tc.items) {
      const y = Math.round((it.transform?.[5] ?? 0) * 10) / 10;
      if (lastY !== null && Math.abs(y - lastY) > 2) flush();
      lastY = y;
      line.push(it.str);
      if (it.hasEOL) flush();
    }
    flush();
  }
  try { await doc.destroy(); } catch { /* يُهمَل */ }
  if (!out.length) {
    throw new Error('لا نصَّ في ملفِّ PDF — لعلَّه صورٌ ممسوحةٌ ضوئيًّا.');
  }
  return out.join('\n');
}

export const KIND_OF = name => {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'pdf') return 'pdf';
  return '';
};

// يُستخرَج النصُّ بحسب النوع، ويُرمى خطأٌ مفهومٌ إن تعذَّر
export async function extractText(file) {
  const kind = KIND_OF(file?.name);
  if (kind === 'docx') return docxHtml(file);
  if (kind === 'pdf') return pdfHtml(file);
  if (kind === 'doc') {
    throw new Error('صيغةُ .doc القديمةُ لا تُقرأ — احفظْه .docx ثم ارفعْه.');
  }
  throw new Error('الملفُّ ليس وورد ولا PDF.');
}
