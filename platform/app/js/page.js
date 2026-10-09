// صفحة A4 على كليشة الهيئة: مقاسات ثابتة موحّدة لكل المواد في المحرر والطباعة وملف Word.
import { h, fmtHijri } from './ui.js';
import { MOSQUE, langName, state } from './store.js';

// المساحة المخصصة للكتابة (مم) — لا تتغير من مادة لأخرى
export const PAGE = { w: 210, h: 297, top: 38, bottom: 32, side: 20 };
export const LETTERHEAD = '/assets/letterhead.jpg';

// حدودٌ واحدةٌ لكلِّ مُخرَجٍ على الكليشة (ملاحظتا ٢٧٤ و٢٨٠):
//   numH  شريطُ رقم الصفحة تحت صندوق الكتابة
//   safeH فسحةُ أمانٍ تمنع ملامسةَ المحتوى لذيل الكليشة
// وهي المقاساتُ التي ثبتت في تصدير المادة والكتاب المجمَّع منذ ملاحظة ٧١،
// فتُعمَّم على المُخرَجات كلِّها فلا يشذُّ واحدٌ عن الحدود.
export const BOX = { numH: 8, safeH: 9 };
export const boxWidth  = () => PAGE.w - PAGE.side * 2;
export const boxHeight = () => PAGE.h - PAGE.top - PAGE.bottom;
export const winHeight = () => boxHeight() - BOX.numH - BOX.safeH;

// التحقق من رقم التوثيق المطبوع: صفحة عامة يفتحها رمز QR (ملاحظة ١٣٤)
export const PUBLIC_SITE = 'https://haramainsermons.com';
export const docVerifyUrl = no => `${PUBLIC_SITE}/verify?doc=${encodeURIComponent(no || '')}`;

// ـــ ختمُ التوثيق: واحدٌ في كلِّ المخرجات — رقمُه وتاريخُه الهجريُّ
//   ورمزُ تحقُّقه، في موضعٍ واحدٍ وهيئةٍ واحدة (ملاحظة ٤١٤)
export const DOC_STAMP_CSS = (side = PAGE.side) => `
.doc-stamp { position: absolute; top: 9mm; left: ${side}mm; display: flex; align-items: center;
  gap: 3mm; font-size: 8pt; color: #3b3630; text-align: start; }
.doc-stamp img.qr { width: 17mm; height: 17mm; }
.doc-stamp .lbl { font-size: 7.5pt; color: #6b6257; }
.doc-stamp .no { font-size: 11pt; font-weight: 700; letter-spacing: .6px; direction: ltr; margin: .4mm 0; }
.doc-stamp .dt { font-size: 7.5pt; color: #3b3630; }`;

// يُبنى الختمُ في مستندٍ مُعطًى. qr: دالّةٌ تُعطي صورةَ الرمز أو فراغًا.
export function docStampNode(d, track, qr) {
  const no = track && track.doc_no;
  if (!no) return null;
  const stamp = d.createElement('div');
  stamp.className = 'doc-stamp'; stamp.dir = 'rtl'; stamp.lang = 'ar';
  let src = '';
  try { src = qr ? qr(docVerifyUrl(no)) : ''; } catch { src = ''; }
  if (src) {
    const img = d.createElement('img');
    img.className = 'qr'; img.alt = `رمز التحقق من ${no}`; img.src = src;
    stamp.append(img);
  }
  const box = d.createElement('div');
  const mk = (cls, text, ltr) => {
    const e = d.createElement('div');
    e.className = cls; e.textContent = text;
    if (ltr) e.dir = 'ltr';
    return e;
  };
  box.append(mk('lbl', 'رقم التوثيق'), mk('no', no, true),
    mk('dt', `تاريخ الترجمة: ${fmtHijri(track.doc_no_at || track.completed_at)}`));
  stamp.append(box);
  return stamp;
}

const SERMON_LABEL = { 'خطبة جمعة': 'خطبة الجمعة', 'خطبة عرفة': 'خطبة يوم عرفة',
  'خطبة عيد الأضحى': 'خطبة عيد الأضحى', 'خطبة عيد الفطر': 'خطبة عيد الفطر',
  'خطبة استسقاء': 'خطبة الاستسقاء', 'خطبة كسوف': 'خطبة الكسوف', 'خطبة خسوف': 'خطبة الخسوف' };

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
      ['التاريخ', m.sermon_date && fmtHijri(m.sermon_date)],
      ['اللغة', languageCode && langName(languageCode)]
    ].filter(([, v]) => v);
  }
  return [
    ['العنوان', m.title],
    ['الخطيب', khateeb || m.khateeb?.name],
    ['التاريخ', m.sermon_date && fmtHijri(m.sermon_date)],
    ['اللغة', languageCode && langName(languageCode)]
  ].filter(([, v]) => v);
}

// اسم ملف واضح، ووفق نمط التسمية الموحَّد متى ضبطته الإدارة (ملاحظة ١٤٤)
//   العناصر: {doc_no} {kind} {sub} {mosque} {hijri} {date} {lang} {title} {khateeb}
export const NAME_TOKENS = ['doc_no', 'kind', 'sub', 'mosque', 'hijri', 'date', 'lang', 'title', 'khateeb'];
const clean = s => String(s ?? '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

export function nameParts(m, languageCode, khateeb, docNo) {
  return {
    doc_no: docNo || '',
    kind: heading(m),
    sub: m.sermon_type || m.material_type || '',
    mosque: (m.mosque && MOSQUE[m.mosque]) || '',
    hijri: m.sermon_date ? fmtHijri(m.sermon_date) : '',
    date: m.sermon_date || '',
    lang: languageCode ? langName(languageCode) : '',
    title: m.title || '',
    khateeb: khateeb || m.khateeb?.name || ''
  };
}

export function applyPattern(pattern, parts) {
  const out = String(pattern).replace(/\{(\w+)\}/g, (_, k) => parts[k] ?? '');
  // ما خلا من قيمة يترك فاصلًا معلقًا، فتُنظَّف الفواصل المتكررة
  return clean(out).replace(/\s*[-–]\s*(?=\s*[-–]|$)/g, '').replace(/^[\s\-–,،]+|[\s\-–,،]+$/g, '').trim();
}

export function fileName(m, languageCode, khateeb, n, docNo) {
  const parts = nameParts(m, languageCode, khateeb, docNo);
  const pattern = (typeof state !== 'undefined' && state.filePattern) || null;
  const base = pattern
    ? applyPattern(pattern, parts)
    : [`${heading(m)} (${m.title})`, parts.khateeb, parts.date, parts.lang].filter(Boolean).join('، ');
  const name = (n ? `${n} - ` : '') + base;
  return clean(name).slice(0, 180);
}

// تسمية العمود الأول بحسب نوع المادة: خطبة أو درس أو كتاب… لا «الخطبة» دائمًا (ملاحظة ٣٧)
const KIND_LABEL = { 'خطب': 'الخطبة', 'دروس علمية': 'الدرس', 'كتب': 'الكتاب', 'مطويات': 'المطوية',
  'منشورات': 'المنشور', 'إعلانات': 'الإعلان', 'توجيهات': 'التوجيه' };
export const kindLabel = m => (m.sermon_type ? 'الخطبة' : (KIND_LABEL[m.material_type] || 'المادة'));

// أعمدة البطاقة: نوع المادة ثم بقية البيانات — صفّان فقط (تسميات ثم قيم)
// ورقم التوثيق يُضاف حين يُمنح، فيُطبع على العمل في كل مخرجاته (ملاحظة ١٣٤)
export function cardColumns(m, languageCode, khateeb, docNo = null) {
  return [[kindLabel(m), heading(m)], ...cardRows(m, languageCode, khateeb),
    ...(docNo ? [['رقم التوثيق', docNo]] : [])];
}

// ---------------------------------------------------------------------
// بطاقةٌ بصفَّين: العربيةُ ثم لغةُ الخطبة في العمود نفسِه (ملاحظة ٣٤١)
//
//   القارئُ بلغةِ الخطبة لا يقرأ العربية، فتُعاد عليه صفوفُ البطاقة
//   بلغته: تسميةُ المادة، وعنوانُها كما ترجمه صاحبُه إن كتبه، والتاريخُ
//   بتقويمه، واسمُ لغته بلسانها. وما لا يُترجَم — اسمُ الخطيب — يبقى
//   كما هو، فالأعلامُ لا تُترجَم.
// ---------------------------------------------------------------------
const KIND_TR = {
  en: 'Friday Sermon', fr: 'Sermon du vendredi', es: 'Sermón del viernes',
  pt: 'Sermão de sexta-feira', it: 'Sermone del venerdì', de: 'Freitagspredigt',
  nl: 'Vrijdagpreek', sv: 'Fredagspredikan', sq: 'Hutbeja e xhumasë',
  bs: 'Džuma-hutba', ru: 'Пятничная проповедь', tr: 'Cuma Hutbesi',
  ur: 'خطبۂ جمعہ', fa: 'خطبهٔ جمعه', ms: 'Khutbah Jumaat',
  id: 'Khutbah Jumat', fil: 'Sermon ng Biyernes', ha: 'Huduba ta Juma’a',
  bn: 'জুমার খুতবা', hi: 'जुमा का ख़ुत्बा', ne: 'जुम्माको खुत्बा',
  th: 'คุฏบะฮฺวันศุกร์', km: 'អំណានថ្ងៃសុក្រ', zh: '主麻演讲', ja: '金曜説教',
  ko: '금요 설교', sw: 'Khutba ya Ijumaa', am: 'የዓርብ ኹጥባ', so: 'Khudbada Jimcaha'
};
const PLACE_TR = {
  en: { makkah: 'the Grand Mosque', madinah: 'the Prophet’s Mosque' },
  fr: { makkah: 'la Grande Mosquée', madinah: 'la Mosquée du Prophète' },
  es: { makkah: 'la Gran Mezquita', madinah: 'la Mezquita del Profeta' },
  pt: { makkah: 'a Mesquita Sagrada', madinah: 'a Mesquita do Profeta' },
  tr: { makkah: 'Mescid-i Haram', madinah: 'Mescid-i Nebevî' },
  ru: { makkah: 'Заповедной мечети', madinah: 'Мечети Пророка' },
  id: { makkah: 'Masjidil Haram', madinah: 'Masjid Nabawi' },
  ms: { makkah: 'Masjidil Haram', madinah: 'Masjid Nabawi' },
  ur: { makkah: 'مسجد حرام', madinah: 'مسجد نبوی' },
  fa: { makkah: 'مسجدالحرام', madinah: 'مسجد نبوی' },
  bn: { makkah: 'মসজিদুল হারাম', madinah: 'মসজিদে নববী' },
  zh: { makkah: '禁寺', madinah: '先知清真寺' }
};
const FIELD_TR = {
  en: ['Sermon', 'Topic', 'Preacher', 'Date', 'Language', 'Document no.'],
  fr: ['Sermon', 'Sujet', 'Prédicateur', 'Date', 'Langue', 'N° du document'],
  es: ['Sermón', 'Tema', 'Predicador', 'Fecha', 'Idioma', 'N.º de documento'],
  pt: ['Sermão', 'Tema', 'Pregador', 'Data', 'Idioma', 'N.º do documento'],
  tr: ['Hutbe', 'Konu', 'Hatip', 'Tarih', 'Dil', 'Belge no.'],
  ru: ['Проповедь', 'Тема', 'Проповедник', 'Дата', 'Язык', '№ документа'],
  id: ['Khutbah', 'Tema', 'Khatib', 'Tanggal', 'Bahasa', 'No. dokumen'],
  ms: ['Khutbah', 'Tajuk', 'Khatib', 'Tarikh', 'Bahasa', 'No. dokumen'],
  ur: ['خطبہ', 'موضوع', 'خطیب', 'تاریخ', 'زبان', 'نمبر دستاویز'],
  fa: ['خطبه', 'موضوع', 'خطیب', 'تاریخ', 'زبان', 'شمارهٔ سند'],
  bn: ['খুতবা', 'বিষয়', 'খতিব', 'তারিখ', 'ভাষা', 'নথি নম্বর'],
  zh: ['演讲', '主题', '演讲者', '日期', '语言', '文件编号']
};
const trOf = (map, code) => map[code] || map[String(code).split('-')[0]] || map.en || null;

export function headingTr(m, code) {
  const kind = trOf(KIND_TR, code);
  if (!kind) return heading(m);
  const place = trOf(PLACE_TR, code);
  const at = place && m.mosque ? place[m.mosque] : null;
  if (!at) return kind;
  return /^(ur|fa|bn|zh|ja|ko|th|km)$/.test(code) ? `${at} — ${kind}` : `${kind} at ${at}`;
}

// صفُّ البطاقة بلغة الخطبة: [التسمية، القيمة]
export function cardRowsTr(m, languageCode, khateeb, titleTr, docNo) {
  if (!languageCode || languageCode === 'ar') return null;
  const lbl = trOf(FIELD_TR, languageCode);
  if (!lbl) return null;
  const dt = m.sermon_date
    ? new Date(`${m.sermon_date}T12:00:00`).toLocaleDateString(languageCode,
        { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const native = (typeof state !== 'undefined' && state.languages || [])
    .find(l => l.code === languageCode)?.native_name || langName(languageCode);
  return [
    [lbl[0], headingTr(m, languageCode)],
    [lbl[1], (titleTr || m.title || '')],
    [lbl[2], (khateeb || m.khateeb?.name || '')],
    [lbl[3], dt],
    [lbl[4], native],
    ...(docNo ? [[lbl[5], docNo]] : [])
  ];
}

// بطاقة بيانات الخطبة داخل مساحة الترجمة: صفّان بعرض الصفحة
export function dataCard(m, languageCode, khateeb, docNo = null) {
  const cols = cardColumns(m, languageCode, khateeb, docNo);
  const isNo = k => k === 'رقم التوثيق';
  return h('table.data-card', { dir: 'rtl', lang: 'ar', contenteditable: 'false' },
    h('thead', h('tr', cols.map(([k]) => h('th', k)))),
    h('tbody', h('tr', cols.map(([k, v]) => h('td', { class: isNo(k) ? 'doc-cell' : '' }, v)))));
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
    if (el.classList.contains('lh-guides')) continue;   // طبقة العلامات لا تُحتسب (ملاحظة ١٣٣)
    let rect = el.getBoundingClientRect();
    if (el.classList.contains('area')) { const r = document.createRange(); r.selectNodeContents(el); rect = r.getBoundingClientRect(); }
    if (rect.height) bottom = Math.max(bottom, rect.bottom - top);
  }
  return Math.max(1, Math.ceil((bottom - 1) / box));
}
