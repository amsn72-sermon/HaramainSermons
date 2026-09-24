// صفحة A4 على كليشة الهيئة: مقاسات ثابتة موحّدة لكل المواد في المحرر والطباعة وملف Word.
import { h, fmtSermonDate } from './ui.js';
import { MOSQUE, langName } from './store.js';

// المساحة المخصصة للكتابة (مم) — لا تتغير من مادة لأخرى
export const PAGE = { w: 210, h: 297, top: 38, bottom: 32, side: 20 };
export const LETTERHEAD = '/assets/letterhead.jpg';

const SERMON_LABEL = { 'خطبة جمعة': 'خطبة الجمعة', 'خطبة عرفة': 'خطبة يوم عرفة', 'خطبة استسقاء': 'خطبة الاستسقاء', 'خطبة كسوف': 'خطبة الكسوف' };

// «خطبة الجمعة من المسجد الحرام»
export function heading(m) {
  const kind = m.sermon_type ? (SERMON_LABEL[m.sermon_type] || m.sermon_type) : (m.material_type || 'مادة');
  return (m.mosque && MOSQUE[m.mosque]) ? `${kind} من ${MOSQUE[m.mosque]}` : kind;
}

// المواد العامة: كتب ومطويات ومنشورات وإعلانات وتوجيهات — لا تتبع مسجدًا ولا خطيبًا (ملاحظتا ٦٩ و٧٢)
const GENERAL_TYPES = ['كتب', 'مطويات', 'منشورات', 'إعلانات', 'توجيهات'];
export const isGeneralMaterial = m => !m?.sermon_type && GENERAL_TYPES.includes(m?.material_type);
// «المؤلف» للكتب والمطويات والمنشورات، و«الجهة» للإعلانات والتوجيهات
const SOURCE_LABEL = { 'كتب': 'المؤلف', 'مطويات': 'المؤلف', 'منشورات': 'المؤلف',
  'إعلانات': 'الجهة', 'توجيهات': 'الجهة' };

// بطاقة البيانات الثابتة: [التسمية، القيمة]
export function cardRows(m, languageCode, khateeb) {
  if (isGeneralMaterial(m)) {
    return [
      ['العنوان', m.title],
      [SOURCE_LABEL[m.material_type] || 'المؤلف', m.author],
      ['التاريخ', m.sermon_date && fmtSermonDate(m.sermon_date)],
      ['اللغة', languageCode && langName(languageCode)]
    ].filter(([, v]) => v);
  }
  return [
    ['العنوان', m.title],
    ['الخطيب', khateeb || m.khateeb?.name],
    ['التاريخ', m.sermon_date && fmtSermonDate(m.sermon_date)],
    ['اللغة', languageCode && langName(languageCode)]
  ].filter(([, v]) => v);
}

// اسم ملف واضح: خطبة الجمعة من المسجد الحرام (العنوان) اسم الخطيب، التاريخ، اللغة
export function fileName(m, languageCode, khateeb, n) {
  const date = m.sermon_date ? m.sermon_date : '';
  const parts = [`${heading(m)} (${m.title})`, khateeb || m.khateeb?.name, date, languageCode && langName(languageCode)].filter(Boolean);
  const name = (n ? `${n} - ` : '') + parts.join('، ');
  return name.replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

// تسمية العمود الأول بحسب نوع المادة: خطبة أو درس أو كتاب… لا «الخطبة» دائمًا (ملاحظة ٣٧)
const KIND_LABEL = { 'خطب': 'الخطبة', 'دروس علمية': 'الدرس', 'كتب': 'الكتاب', 'مطويات': 'المطوية',
  'منشورات': 'المنشور', 'إعلانات': 'الإعلان', 'توجيهات': 'التوجيه' };
export const kindLabel = m => (m.sermon_type ? 'الخطبة' : (KIND_LABEL[m.material_type] || 'المادة'));

// أعمدة البطاقة: نوع المادة ثم بقية البيانات — صفّان فقط (تسميات ثم قيم)
export function cardColumns(m, languageCode, khateeb) {
  return [[kindLabel(m), heading(m)], ...cardRows(m, languageCode, khateeb)];
}

// بطاقة بيانات الخطبة داخل مساحة الترجمة: صفّان بعرض الصفحة
export function dataCard(m, languageCode, khateeb) {
  const cols = cardColumns(m, languageCode, khateeb);
  return h('table.data-card', { dir: 'rtl', lang: 'ar', contenteditable: 'false' },
    h('thead', h('tr', cols.map(([k]) => h('th', k)))),
    h('tbody', h('tr', cols.map(([, v]) => h('td', v)))));
}

// إطار الصفحة: body هو صندوق الكتابة الثابت
export function letterheadPage(...children) {
  const body = h('div.lh-body', children);
  const page = h('div.a4.lh-page', body);
  return { page, body };
}

// عدد الصفحات المتوقع عند الطباعة: ارتفاع المحتوى الفعلي إلى ارتفاع صندوق الكتابة
export function pagesEstimate(body) {
  const box = body.clientHeight || 1;
  const top = body.getBoundingClientRect().top - body.scrollTop;
  let bottom = 0;
  for (const el of body.children) {
    let rect = el.getBoundingClientRect();
    if (el.classList.contains('area')) { const r = document.createRange(); r.selectNodeContents(el); rect = r.getBoundingClientRect(); }
    if (rect.height) bottom = Math.max(bottom, rect.bottom - top);
  }
  return Math.max(1, Math.ceil((bottom - 1) / box));
}
