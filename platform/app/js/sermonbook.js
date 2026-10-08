// مجمَّعُ الخطب السنوي: يُبنى في المنصة على التصميم القائم
// (ملاحظات ٣٠٤ و٣٠٩ و٣١٠ و٣١١، ثم ٣٣٤ و٣٣٥ و٣٣٦)
//
//   الغلافُ ثم البسملةُ ثم صفحةُ الحقوقِ ثم المقدمةُ ثم الفهرسُ، ثم
//   صفحةُ عنوانٍ لكلِّ خطبةٍ ومتنُها. والصفحاتُ تُقاس وتُقطع بأيدينا كما
//   في كلِّ مُخرَجات المنصة منذ ملاحظة ٢٧٤ — فلا يفيض شيءٌ ولا يُترك
//   فراغٌ عبثًا.
//
//   وما استُدرك في ملاحظات ٣٣٤–٣٣٦:
//   ١) المتنُ كان يُشقُّ عند كلِّ وسمٍ داخليٍّ فتتناثر الكلمةُ أحرفًا
//      («Mu» ثم «ṣ» ثم «ḥ» ثم «af»)، وكانت رموزُ HTML تُهرَّب مرتين
//      فتُطبع `&#39;` على وجهها. فصار الشقُّ على الفقرات وحدَها،
//      والزينةُ الداخليةُ تبقى كما كتبها المترجم.
//   ٢) البسملةُ صارت صورةَ الهيئة لا رسمًا تقريبيًّا.
//   ٣) وصُمِّم الغلافُ وصفحةُ عنوان الخطبة والكليشةُ الداخليةُ وترقيمُ
//      الصفحات على نسقٍ واحد: ورقٌ عاجيٌّ ورايةٌ خضراءُ وحليةٌ ذهبية.
import { openSheetWindow, measureBlocks, flowBlocks, mm2px } from './sheetflow.js';
import { h, toast, dialog, escapeHtml, fmtHijri } from './ui.js';
import { db } from './sb.js';
import { langName, MOSQUE } from './store.js';
import { qrDataUri } from './qr.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

// مسارٌ مطلق: ما يُكتب في نافذة المعاينة لا أصلَ له يُسنِد إليه النسبيّ
const abs = src => (/^(data:|blob:|https?:)/.test(String(src))
  ? String(src) : new URL(String(src), location.origin).href);

// المقاساتُ تُختار عند التصدير لا تُثبَّت في الأرشفة (ملاحظة ٣٠٥)
export const SIZES = {
  a4:   { w: 210, h: 297, name: 'A4 — 210×297 مم' },
  a5:   { w: 148, h: 210, name: 'A5 — 148×210 مم' },
  book: { w: 170, h: 240, name: '17×24 سم — مقاسُ المطابع' }
};

// مكتبةُ خلفياتِ الغلاف: نماذجُك الثلاثةُ جاهزةً تُنتقى بالاسم (ملاحظة ٣١٠)
export const COVER_BGS = [
  ['/assets/cover-kaaba.jpg',    'الكعبةُ والمطاف'],
  ['/assets/cover-minbar.jpg',   'المنبرُ والكعبة'],
  ['/assets/cover-minbar2.jpg',  'المنبرُ من قرب']
];

// الشعاراتُ الثلاثةُ الافتراضية (ملاحظة ٣١٠)
export const BOOK_MARKS = [
  { src: '/assets/alharamain-logo-dark.png', x: 6,  y: 6, h: 16 },
  { src: '/assets/presidency.png',           x: 24, y: 6, h: 16 },
  { src: '/assets/uqu-logo.png',             x: 74, y: 6, h: 16 }
];

// صورتا الهيئة: البسملةُ في معيَّنها، وشريطُها الكوفيُّ (ملاحظة ٣٣٥)
export const BASMALA_IMG  = '/assets/basmala.png';
export const BASMALA_BAND = '/assets/basmala-band.jpg';

// خطُّ كلِّ لغةٍ ومقاسُه (ملاحظة ٣١١)
const FONTS = {
  ar:  { stack: '"Noto Naskh Arabic","Amiri",serif',        size: 13,   line: 1.8,  dir: 'rtl' },
  ur:  { stack: '"Jameel Noori Kasheeda","Noto Nastaliq Urdu",serif', size: 14, line: 2.2, dir: 'rtl' },
  fa:  { stack: '"B Zar","Noto Naskh Arabic",serif',        size: 13.5, line: 1.8,  dir: 'rtl' },
  bn:  { stack: '"Kalpurush","Noto Serif Bengali",serif',   size: 13,   line: 1.9,  dir: 'ltr' },
  ru:  { stack: '"PT Serif",Georgia,serif',                 size: 12,   line: 1.6,  dir: 'ltr' },
  tr:  { stack: '"Source Serif 4","PT Serif",serif',        size: 11.5, line: 1.5,  dir: 'ltr' },
  zh:  { stack: '"Noto Serif SC",serif',                    size: 11,   line: 1.7,  dir: 'ltr' },
  hi:  { stack: '"Noto Serif Devanagari",serif',            size: 12.5, line: 1.9,  dir: 'ltr' },
  ne:  { stack: '"Noto Serif Devanagari",serif',            size: 12.5, line: 1.9,  dir: 'ltr' },
  th:  { stack: '"Noto Serif Thai",serif',                  size: 12.5, line: 2.0,  dir: 'ltr' },
  km:  { stack: '"Noto Serif Khmer",serif',                 size: 12,   line: 2.1,  dir: 'ltr' },
  def: { stack: '"EB Garamond",Garamond,Georgia,serif',     size: 11.5, line: 1.5,  dir: 'ltr' }
};
export const fontOf = code => FONTS[code] || FONTS.def;

// القالبُ الافتراضي: الورقُ العاجيُّ والرايةُ الخضراء (ملاحظتا ٣١٠ و٣٣٦)
export const DEFAULT_TPL = () => ({
  size: 'book',
  cover: {
    bg: null, fade: 22, pattern: true,
    marks: BOOK_MARKS.map(m => ({ ...m })),
    paper: '#f5efe4', ink: '#174a38', gold: '#b9975b',
    bannerW: 30, bannerTop: 26, titleY: 52, foot: true
  },
  divider: { paper: '#f5efe4', banner: true, bannerW: 34, ghost: false,
             stamp: true, midY: 62, ink: '#174a38', marks: [], texts: [] },
  inner: { head: true, foot: true, band: true, pageno: 'circle', ornament: false,
           ink: '#1d2b3a', gold: '#b9975b', paper: '#ffffff', numStart: 1,
           marks: [], texts: [] },
  // صفحةُ البسملة وصفحةُ الحقوق: وجها الكتاب المفتوحِ بعد الغلاف (٣٥٥)
  front:    { marks: [], texts: [] },
  colophon: { marks: [], texts: [], rights: '' },
  // ظهرُ الكتاب — لم يكن له وجودٌ قبلُ (ملاحظة ٣٥٥)
  back: { paper: '#f5efe4', ink: '#174a38', gold: '#b9975b', pattern: true,
          bg: null, fade: 16, blurb: '', isbn: '', foot: true, mark: true,
          marks: [], texts: [] },
  // هوامشُ الصفحة بالمليمتر — الداخليُّ أوسعُ، فالخيطُ يأكل منه
  margins: { top: 22, bottom: 18, inner: 22, outer: 16 },
  intro: ''
});

// صفحاتُ القالب التي تحمل صورًا ونصوصًا حرّة
export const TPL_SLOTS = ['cover', 'front', 'colophon', 'divider', 'inner', 'back'];
export const slotOf = (tpl, key) => {
  const s = tpl[key] = tpl[key] || {};
  if (!Array.isArray(s.marks)) s.marks = [];
  if (!Array.isArray(s.texts)) s.texts = [];
  return s;
};

// ---------------------------------------------------------------------
// نافذةُ الإصدار: اللغةُ والمسجدُ والمقاسُ والقالب، ثم معاينة (٣١١)
// ---------------------------------------------------------------------
export async function bookDialog(year, section) {
  let langs = [];
  try { langs = await db.rpc('arch_book_langs', { p_year: year }) || []; } catch { langs = []; }
  if (!langs.length) return toast('لا نسخَ في هذا العام بعد.', 'bad');

  // القوالبُ المحفوظةُ تُنتقى بالاسم، ولكلٍّ تصميمُه (ملاحظتا ٣٤٢ و٣٣٩)
  let saved = [];
  try { saved = await db.rpc('book_templates_list') || []; } catch { saved = []; }
  const pickOf = () => saved.find(r => String(r.id) === tplSel.value) || null;
  let tpl = DEFAULT_TPL();
  const first = saved.find(r => r.h_year === year) || saved.find(r => r.is_default) || saved[0];
  if (first && first.tpl) tpl = mergeTpl(tpl, first.tpl);

  const lang = h('select', { 'aria-label': 'اللغة' },
    langs.map(l => h('option', { value: l.language_code },
      `${l.name_ar} (${AR(l.n)} خطبة)`)));
  const mosque = h('select', { 'aria-label': 'المسجد' },
    h('option', { value: '' }, 'الحرمان معًا'),
    Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v)));
  const size = h('select', { 'aria-label': 'المقاس' },
    Object.entries(SIZES).map(([k, v]) =>
      h('option', { value: k, selected: tpl.size === k }, v.name)));
  const title = h('input', { value: 'مجمَّع الخطب السنوي', 'aria-label': 'عنوان المجمَّع' });
  const intro = h('textarea', { rows: 4, 'aria-label': 'المقدمة' }, tpl.intro || '');
  const withIntro = h('input', { type: 'checkbox', checked: tpl.intro ? true : null,
    'aria-label': 'إدراج المقدمة' });
  const fmt = h('select', { 'aria-label': 'الصيغة' },
    h('option', { value: 'pdf', selected: true }, 'PDF — للطباعة والنشر'),
    h('option', { value: 'docx' }, 'Word — للتسليم والتعديل'));

  // اختيارُ القالب المحفوظ، وبابُ تصميمه مستقلٌّ في صفحة الأعوام
  const tplSel = h('select', { 'aria-label': 'قالبُ المجمَّع' },
    saved.length
      ? saved.map(r => h('option', { value: r.id, selected: first && r.id === first.id },
          `${r.name}${r.is_default ? ' ★' : ''}${r.h_year ? ` — ${ARY(r.h_year)}هـ` : ''}`))
      : [h('option', { value: '' }, 'القالبُ الافتراضي')]);
  tplSel.onchange = () => {
    const r = pickOf();
    tpl = mergeTpl(DEFAULT_TPL(), r?.tpl || {});
    if (r) tpl.name = r.name;
    size.value = tpl.size || 'book';
  };
  const tplBtn = h('a.btn.sm', { href: '/app/book-design' }, '🖌 تصميمُ القوالب');

  const res = await dialog({
    title: `إصدارُ مجمَّع ${ARY(year)}هـ`,
    body: h('div.stack',
      h('p.small.muted', 'يُبنى المجمَّعُ من خطب العام: غلافٌ ثم بسملةٌ ثم حقوقٌ ثم مقدمةٌ ثم فهرس، '
        + 'ثم صفحةُ عنوانٍ لكلِّ خطبةٍ ومتنُها. ويُعايَن قبل أن يخرج.'),
      h('div.grid-2',
        h('label.field', 'اللغة', lang),
        h('label.field', 'المسجد', mosque),
        h('label.field', 'المقاس', size),
        h('label.field', 'الصيغة', fmt)),
      h('label.field', 'عنوانُ المجمَّع', title),
      h('fieldset.stack', h('legend', 'المقدمة'),
        h('label.check', withIntro, h('span', 'أدرِجْ مقدمةً في أوّله')),
        intro,
        h('p.small.muted', 'تُحفَظ مع القالب فلا تُعاد كتابتُها كلَّ عام.')),
      h('div.row.between.wrap',
        h('label.field', { style: { flex: 1, minWidth: '220px' } }, 'القالب', tplSel), tplBtn)),
    buttons: [
      { label: 'عايِنْ ثم صدِّرْ', kind: 'primary',
        value: () => ({ lang: lang.value, mosque: mosque.value || null, size: size.value,
          title: title.value.trim() || 'مجمَّع الخطب السنوي',
          intro: withIntro.checked ? intro.value.trim() : '', fmt: fmt.value }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return;

  let rows = [];
  try {
    rows = await db.rpc('arch_book', { p_year: year, p_lang: res.lang,
      p_mosque: res.mosque, p_section: section ? section.id : null }) || [];
  } catch (e) { return toast(e.message, 'bad'); }
  if (!rows.length) return toast('لا خطبَ بهذه التصفية.', 'bad');

  const chosen = pickOf();
  if (chosen) { tpl = mergeTpl(DEFAULT_TPL(), chosen.tpl || {}); tpl.name = chosen.name; }
  tpl = { ...tpl, size: res.size, intro: res.intro };
  if (res.fmt === 'docx') return bookWord(rows, { year, ...res, tpl });
  if (!buildBook(rows, { year, ...res, tpl })) {
    toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
  }
}

// القوالبُ المحفوظةُ قديمًا تنقصها حقولُ التصميم الجديدة، فتُستكمل
// بالافتراضيّ بدل أن تخرج بلا أرضيةٍ ولا كليشة (ملاحظة ٣٣٦)
function mergeTpl(base, saved) {
  const out = { ...base, ...saved };
  for (const k of [...TPL_SLOTS, 'margins']) {
    out[k] = { ...(base[k] || {}), ...((saved || {})[k] || {}) };
  }
  if (!Array.isArray(out.cover.marks) || !out.cover.marks.length) {
    out.cover.marks = BOOK_MARKS.map(m => ({ ...m }));
  }
  for (const k of TPL_SLOTS) slotOf(out, k);
  return out;
}

// صورٌ ونصوصٌ حرّةٌ تُنثر على صفحةٍ بإحداثياتها (ملاحظة ٣٥٥)
export function decorate(el, img, sheetEl, slot) {
  for (const m of (slot?.marks || [])) {
    if (!m || !m.src) continue;
    const im = img(m.src, 'deco-mk');
    im.style.insetInlineStart = `${m.x}%`;
    im.style.top = `${m.y}%`;
    im.style.height = `${m.h}mm`;
    if (m.opacity != null) im.style.opacity = String(Math.max(0, Math.min(100, m.opacity)) / 100);
    sheetEl.append(im);
  }
  for (const x of (slot?.texts || [])) {
    if (!x || !String(x.text || '').trim()) continue;
    const tx = el('div', 'deco-tx', escapeHtml(String(x.text)).replace(/\n/g, '<br>'));
    tx.style.insetInlineStart = `${x.x ?? 10}%`;
    tx.style.top = `${x.y ?? 10}%`;
    tx.style.width = `${x.w ?? 80}%`;
    tx.style.fontSize = `${x.size ?? 4}mm`;
    tx.style.color = x.color || '#174a38';
    tx.style.textAlign = x.align || 'center';
    tx.style.fontWeight = x.bold ? '700' : '400';
    sheetEl.append(tx);
  }
}

// ملاحظة: تصميمُ القوالب انتقل إلى بابه المستقلِّ في صفحة الأعوام
//   (/app/book-design) على آليّة مصمِّم الشهادات — لوحةٌ تُرى وأدواتٌ
//   تحتها، لا حقولٌ لا يُعرَف أثرُها إلا بعد البناء (ملاحظتا ٣٣٩ و٣٥٠).

// ---------------------------------------------------------------------
// نصُّ النسخة ← فقراتُه (ملاحظة ٣٣٤)
//
//   كان الشقُّ يستبدل بكلِّ وسمٍ سطرًا جديدًا، والوسومُ الداخليةُ
//   (<strong> و<em>) تُحيط بحرفٍ واحدٍ في أسماء الأعلام المنقولةِ
//   بالحروف اللاتينية، فتخرج الكلمةُ الواحدةُ أربعَ فقرات. والشقُّ
//   الآن على عناصر الفقرات وحدَها، والزينةُ تبقى، ورموزُ HTML تُفكُّ
//   مرةً واحدةً فلا يُطبع `&#39;` على وجهه.
// ---------------------------------------------------------------------
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'SECTION', 'ARTICLE', 'FIGCAPTION']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TEMPLATE']);
// الأغلفةُ تُفَكُّ ولا تُعَدُّ فقرةً: الجدولُ وجوفُه وقوائمُه
const WRAP_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'UL', 'OL', 'DL']);
const isBlock = n => n.nodeType === 1
  && (BLOCK_TAGS.has(n.tagName) || WRAP_TAGS.has(n.tagName));

export function htmlParagraphs(html) {
  const src = String(html || '').trim();
  if (!src) return [];
  let body;
  try {
    body = new DOMParser().parseFromString(src, 'text/html').body;
  } catch { body = null; }
  if (!body) return [];

  // نصٌّ خامٌ بلا وسمٍ كُتليٍّ البتّة: يُشقُّ على أسطره لا على فراغاته
  if (!body.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,ul,ol,br')) {
    return (body.textContent || '').split(/\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .map(t => ({ html: escapeHtml(t), text: t }));
  }

  const out = [];
  let buf = '';                      // ما تجمَّع من وسومٍ داخليةٍ ونصٍّ طليق
  const flush = () => {
    const text = stripTags(buf);
    if (text) out.push({ html: buf.trim(), text });
    buf = '';
  };

  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {        // نصٌّ طليقٌ لا يضيع
        buf += escapeHtml(n.textContent || '');
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (SKIP_TAGS.has(n.tagName)) continue;
      if (n.tagName === 'BR') { buf += '<br>'; continue; }
      if (isBlock(n)) {
        // فقرةٌ جديدةٌ تبدأ هنا، وما قبلها يُغلَق
        flush();
        if ([...n.children].some(isBlock)) {
          walk(n);                   // فيها فقراتٌ أخرى: تُفكّ
        } else {
          buf = n.innerHTML;         // ورقةٌ: زينتُها الداخليةُ تبقى كما هي
        }
        flush();
        continue;
      }
      buf += n.outerHTML;            // وسمٌ داخليٌّ: <strong> و<em> وأشباهُهما
    }
  };
  walk(body);
  flush();

  return out;
}

// نصُّ فقرةٍ من HTML: تُنزَع الوسومُ وتُفَكُّ الرموزُ مرةً واحدة
function stripTags(frag) {
  const d = document.createElement('div');
  d.innerHTML = String(frag || '');
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

// فصلُ الخطبة الأولى عن الثانية: العبارةُ المعتادةُ في المتن
export function splitKhutbas(html) {
  const paras = htmlParagraphs(html);
  const TAIL = '\\s*\\)?\\s*[:：.،]?\\s*$';
  const second = new RegExp('^\\(?\\s*(الخطبة|الخُطبة|الخطبه)\\s*(الثانية|الثانيه)' + TAIL);
  const first  = new RegExp('^\\(?\\s*(الخطبة|الخُطبة|الخطبه)\\s*(الأولى|الاولى|الأولي)' + TAIL);
  const out = [[]];
  for (const p of paras) {
    if (second.test(p.text)) { out.push([]); continue; }
    if (first.test(p.text)) continue;
    out[out.length - 1].push(p);
  }
  return out.filter(a => a.length);
}

// ---------------------------------------------------------------------
// بناءُ المجمَّع: صفحاتٌ حقيقيةٌ تُقاس وتُقطع (ملاحظات ٣٠٩ و٣١٠ و٣١١)
// ---------------------------------------------------------------------
export function buildBook(rows, { year, lang, title, intro, tpl }) {
  tpl = mergeTpl(DEFAULT_TPL(), tpl || {});
  const S = SIZES[tpl.size] || SIZES.book;
  const F = fontOf(lang);
  // الهامشُ الداخليُّ أوسعُ: الخيطُ يأكل منه (ملاحظة ٣١١) — ويُضبَط
  //   من المصمِّم (ملاحظة ٣٥٥)
  const M = { top: 22, bottom: 18, inner: 22, outer: 16, ...(tpl.margins || {}) };
  const WIN_W = S.w - M.inner - M.outer;
  const WIN_H = S.h - M.top - M.bottom - 10;      // ١٠ مم لشريط الترقيم

  const ctx = openSheetWindow(bookCss(S, M, WIN_W, WIN_H, F, tpl),
    { lang, dir: 'rtl' });
  if (!ctx) return false;
  const { el, img, pages, measure, w, d } = ctx;

  const esc = escapeHtml;
  const pagesOut = [];
  const sheet = (cls = '') => {
    const s = el('div', 'sheet' + (cls ? ' ' + cls : ''));
    pagesOut.push(s);
    return s;
  };
  const winBox = s => {
    const win = el('div', 'win');
    s.append(win);
    return win;
  };

  ctx.ready(() => {
    // ـــ ١) الغلاف (ملاحظتا ٣٠٩ و٣٣٦)
    const cv = sheet('cover-sheet front');
    const c = el('div', 'cover');
    if (tpl.cover.pattern) c.append(el('div', 'cover-pat'));
    if (tpl.cover.bg) {
      const bg = img(tpl.cover.bg, 'cover-bg');
      bg.style.opacity = String(Math.max(0, Math.min(100, tpl.cover.fade)) / 100);
      c.append(bg);
    }
    const marks = el('div', 'cover-marks');
    for (const m of (tpl.cover.marks || BOOK_MARKS)) {
      const im = img(m.src, 'mk');
      im.style.insetInlineStart = `${m.x}%`;
      im.style.top = `${m.y}%`;
      im.style.height = `${m.h}mm`;
      marks.append(im);
    }
    c.append(marks);
    // الرايةُ المزخرفةُ معلّقةٌ من رأس الغلاف، على نسق صفحات العنوان
    if (Number(tpl.cover.bannerW) > 0) {
      const cban = el('div', 'cover-banner');
      cban.innerHTML = pennantSvg(tpl.cover.ink, tpl.cover.gold);
      c.append(cban);
    }
    const mid = el('div', 'cover-mid');
    mid.append(el('h1', 'ct', esc(title)));
    mid.append(el('div', 'crule'));
    mid.append(el('div', 'cs', esc(`لخُطب ${rowsMosque(rows)} المترجمة`)));
    mid.append(el('div', 'cs2', esc(`إلى ${langName(lang)}`)));
    mid.append(el('div', 'cy', esc(`لعام ${ARY(year)}هـ`)));
    c.append(mid);
    if (tpl.cover.foot !== false) {
      const foot = el('div', 'cover-foot');
      foot.innerHTML = '<span>الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي</span>'
        + '<span>مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين — بتنفيذ جامعة أمِّ القرى</span>';
      c.append(foot);
    }
    cv.append(c);
    decorate(el, img, cv, tpl.cover);

    // ـــ ٢) صفحةُ البسملة — صورةُ الهيئة لا رسمًا تقريبيًّا (ملاحظة ٣٣٥)
    const bs = sheet('plain-sheet front');
    const bd = el('div', 'basmala');
    bd.append(img(BASMALA_IMG, 'bsm'));
    bs.append(bd);
    decorate(el, img, bs, tpl.front);

    // ـــ ٣) صفحةُ الحقوق
    const co = sheet('plain-sheet front');
    const cob = el('div', 'colo');
    cob.innerHTML = `<h2>${esc(title)}</h2>`
      + `<p>لخُطب ${esc(rowsMosque(rows))} المترجمة إلى ${esc(langName(lang))}`
      + ` لعام ${esc(ARY(year))}هـ.</p>`
      + '<p>الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي — '
      + 'مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين، بتنفيذ جامعة أمِّ القرى.</p>'
      + `<div class="rights">${esc(tpl.colophon?.rights
          || 'حقوقُ الطبع محفوظة. ويُرجَع إلى أصلِ كلِّ خطبةٍ في المنصة برقم توثيقها '
             + 'المطبوع في ذيل صفحتها.')}`
      + `<br>عددُ الخطب: ${esc(AR(rows.length))}`
      + ` · أُصدر في ${esc(fmtHijri(new Date().toISOString().slice(0, 10)))}</div>`;
    const qr = d.createElement('img');
    qr.className = 'colo-qr';
    qr.src = qrDataUri(`https://haramainsermons.com/verify?doc=${encodeURIComponent(
      rows[0]?.doc_no || '')}`, { margin: 1, dark: tpl.inner.ink });
    cob.append(qr);
    co.append(cob);
    decorate(el, img, co, tpl.colophon);

    // ـــ ٤) المقدمة (تُدرَج إن كُتبت)
    if (intro) {
      const blocks = intro.split(/\n{2,}/).filter(Boolean)
        .map(p => ({ html: `<p class="intro-p">${esc(p)}</p>` }));
      blocks.unshift({ html: '<h1 class="sec-h">المقدمة</h1>', keep: mm2px(12) });
      measureBlocks(w, measure, blocks);
      flowBlocks(blocks, mm2px(WIN_H), () => winBox(sheet()));
    }

    // ـــ ٥) الفهرس — جدولٌ واحدٌ يُضاف إليه صفٌّ صفًّا (ملاحظة ٣٣٤)
    const idxHead = { html: '<h1 class="sec-h">الفهرس</h1>', keep: mm2px(16) };
    const idxRows = rows.map((r, i) => ({
      head: i === 0,
      html: `<div class="idx-row" data-seq="${i}">`
        + `<span class="n">${AR(i + 1)}</span>`
        + `<span class="ti">${esc(r.title || '—')}</span>`
        + `<span class="kh">${esc(r.khateeb || '—')}</span>`
        + `<span class="dt">${esc(r.hijri_text
            || (r.sermon_date ? fmtHijri(r.sermon_date) : '—'))}</span>`
        + '<span class="pg">…</span></div>'
    }));
    const idxAll = [idxHead,
      { html: '<div class="idx-row idx-th"><span class="n">م</span>'
          + '<span class="ti">موضوع الخطبة</span><span class="kh">الخطيب</span>'
          + '<span class="dt">التاريخ</span><span class="pg">الصفحة</span></div>',
        keep: mm2px(10) },
      ...idxRows];
    measureBlocks(w, measure, idxAll);
    flowBlocks(idxAll, mm2px(WIN_H), () => winBox(sheet()));

    // ـــ ٦) الخطب: صفحةُ عنوانٍ ثم متن
    const sheetOfSermon = [];
    rows.forEach((r, i) => {
      // صفحةُ العنوان (ملاحظتا ٣٠٩ و٣٣٦)
      const ds = sheet('div-sheet');
      const dv = el('div', 'divider');
      if (tpl.divider.banner) {
        const bn = el('div', 'banner');
        bn.innerHTML = pennantSvg(tpl.divider.ink, tpl.cover.gold);
        dv.append(bn);
      }
      if (tpl.divider.ghost && tpl.cover.bg) dv.append(img(tpl.cover.bg, 'div-ghost'));
      const stamp = tpl.divider.stamp === false ? null : el('div', 'div-stamp');
      if (stamp) {
      stamp.innerHTML = `<div>${esc(r.sermon_type || 'خطبة الجمعة')}</div>`
        + `<div>${esc(r.hijri_text || (r.sermon_date ? fmtHijri(r.sermon_date) : ''))}</div>`
        + (r.sermon_date ? `<div>الموافق ${esc(gregLine(r.sermon_date))}</div>` : '');
        dv.append(stamp);
      }
      const dm = el('div', 'div-mid');
      dm.innerHTML = '<div class="dl">موضـوع الخطبة:</div>'
        + `<div class="dt">${esc(r.title)}</div>`
        + (r.khateeb ? '<div class="dl2">لفضيـلة الشيـخ</div>'
            + `<div class="dn">${esc(r.khateeb)}</div>` : '')
        + '<div class="drule"></div>'
        + `<div class="dmeta">${esc(MOSQUE[r.mosque] || '')}`
        + `${r.mosque ? ' · ' : ''}${esc(langName(lang))}</div>`;
      dv.append(dm);
      ds.append(dv);
      decorate(el, img, ds, tpl.divider);

      // المتن: يبدأ من أوّل سطرٍ في الصفحة التالية (ملاحظة ٣٠٩)
      sheetOfSermon[i] = pagesOut.length;      // أوّلُ صفحةِ متنٍ تُنشأ بعدها
      const parts = splitKhutbas(r.body_html || '');
      const blocks = [];
      if (tpl.inner.band) {
        // المسارُ مطلقٌ: نافذةُ المعاينة لا أصلَ لها تُسنِد إليه النسبيّ
        blocks.push({ kind: 'band', h: mm2px(17), keep: mm2px(10),
          html: `<div class="sbd"><img src="${abs(BASMALA_BAND)}" alt=""></div>` });
      }
      parts.forEach((part, k) => {
        blocks.push({ kind: 'head', keep: mm2px(16),
          html: `<h2 class="kh2">(${k === 0 ? 'الخطبةُ الأولى' : 'الخطبةُ الثانية'})</h2>` });
        for (const p of part) blocks.push({ html: `<p class="bp">${p.html}</p>` });
      });
      if (!blocks.length || !parts.length) {
        blocks.push({ html: '<p class="bp muted">لا نصَّ محفوظٌ لهذه النسخة.</p>' });
      }
      blocks.push({ html: `<div class="docno" dir="ltr">${esc(r.doc_no || '')}</div>` });

      // الشريطُ ارتفاعُه معلومٌ بالقياس لا بالصورة، فالصورةُ قد لا تُحمَّل بعد
      const toMeasure = blocks.filter(b => b.kind !== 'band');
      measureBlocks(w, measure, toMeasure);

      const boxPx = mm2px(WIN_H);
      let used = 0;
      let box = winBox(sheet());
      const next = () => { used = 0; return winBox(sheet()); };
      for (const b of blocks) {
        // «الخطبةُ الثانية» تتبع الأولى إن بقي أكثرُ من نصف الصفحة،
        //   وإلا انتقلت إلى رأس التالية (ملاحظة ٣٠٩)
        if (b.kind === 'head' && used > 0 && (boxPx - used) <= boxPx / 2) {
          box = next();
        } else if (used + b.h + (b.keep || 0) > boxPx && used > 0) {
          box = next();
        }
        box.insertAdjacentHTML('beforeend', b.html);
        used += b.h;
      }
    });

    // ـــ ٦ب) ظهرُ الكتاب: آخرُ صفحةٍ فيه، بلا رقمٍ ولا كليشة (ملاحظة ٣٥٥)
    const bk = tpl.back || {};
    if (bk.on !== false) {
      const bcv = sheet('cover-sheet back-sheet front');
      const b = el('div', 'back');
      if (bk.pattern) b.append(el('div', 'cover-pat'));
      if (bk.bg) {
        const bg = img(bk.bg, 'cover-bg');
        bg.style.opacity = String(Math.max(0, Math.min(100, bk.fade ?? 16)) / 100);
        b.append(bg);
      }
      if (bk.mark !== false) {
        const bm = el('div', 'back-mark');
        bm.innerHTML = pennantSvg(bk.ink || tpl.cover.ink, bk.gold || tpl.cover.gold);
        b.append(bm);
      }
      const bmid = el('div', 'back-mid');
      if (String(bk.blurb || '').trim()) {
        bmid.append(el('p', 'back-blurb',
          esc(String(bk.blurb)).replace(/\n/g, '<br>')));
      } else {
        bmid.append(el('p', 'back-blurb', esc(
          `${title} — لخُطب ${rowsMosque(rows)} المترجمة إلى ${langName(lang)} `
          + `لعام ${ARY(year)}هـ.`)));
      }
      b.append(bmid);
      if (bk.foot !== false) {
        const bf = el('div', 'back-foot');
        bf.innerHTML = '<span>الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي</span>'
          + '<span>مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين</span>'
          + (String(bk.isbn || '').trim()
              ? `<span class="isbn" dir="ltr">${esc(String(bk.isbn))}</span>` : '');
        b.append(bf);
      }
      bcv.append(b);
      decorate(el, img, bcv, bk);
    }

    pages.replaceChildren(...pagesOut);

    // ـــ ٧) الترقيم: المقدماتُ بلا رقم، ثم يبدأ العدُّ من المتن
    //       (ملاحظة ٣٣٦ — «وترقيم الصفحات»)
    const folio = new Array(pagesOut.length).fill(0);
    let n = Math.max(0, Number(tpl.inner.numStart ?? 1) - 1);
    pagesOut.forEach((s, i) => {
      if (s.classList.contains('front')) return;   // الغلافُ والبسملةُ والحقوق
      folio[i] = ++n;
      if (tpl.inner.foot && !s.classList.contains('div-sheet')) {
        const box = el('div', 'pageno');
        box.innerHTML = `<span class="pno">${AR(folio[i])}</span>`;
        s.append(box);
      }
      if (tpl.inner.ornament && !s.classList.contains('div-sheet')) {
        const orn = el('div', 'foot-orn');
        orn.innerHTML = footOrnamentSvg(tpl.inner.gold);
        s.append(orn);
      }
      if (tpl.inner.head && !s.classList.contains('div-sheet')) {
        const hd = el('div', 'runhead');
        hd.innerHTML = `<span>${esc(title)}</span>`
          + `<span>${esc(`لعام ${ARY(year)}هـ`)}</span>`;
        s.append(hd);
      }
    });

    // الفهرسُ يُملأ بأرقام الترقيم لا بمواضع الصفحات
    d.querySelectorAll('.idx-row[data-seq] .pg').forEach(span => {
      const i = Number(span.parentElement.getAttribute('data-seq'));
      span.textContent = AR(folio[sheetOfSermon[i]] || 0);
    });

    measure.remove();
    addPreviewBar(ctx, pagesOut, WIN_H);
  }, { autoPrint: false });   // تُعايَن أولًا ثم تُطبع (ملاحظة ٣١١)
  return true;
}

const rowsMosque = rows => {
  const set = new Set(rows.map(r => r.mosque).filter(Boolean));
  if (set.size === 1) return MOSQUE[[...set][0]];
  return 'الحرمين الشريفين';
};

// التاريخُ الميلاديُّ كما يُكتب في صفحات العنوان: ٢٠٢٣/٨/٥م
const gregLine = iso => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}م`;
};

// الرايةُ المعلَّقة: درعٌ أخضرُ بحليةٍ ذهبيةٍ ونجومٍ ثمانيةٍ متشابكة
// (على نسق صفحات العنوان في مطبوعات المشروع — ملاحظة ٣٣٦)
let pennantSeq = 0;
export function pennantSvg(ink, gold) {
  // المعرِّفُ فريدٌ لكلِّ رايةٍ: المعرِّفاتُ المكرَّرةُ في وثيقةٍ واحدةٍ
  //   تجعل القصَّ يتبع أوّلَها (ملاحظة ٣٣٦)
  const id = `pen${++pennantSeq}`;
  const star = (cx, cy, r) => {
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const rad = (k % 2 === 0) ? r : r * 0.46;
      const a = (Math.PI / 8) * k - Math.PI / 2;
      pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
    }
    return `<polygon points="${pts.join(' ')}"/>`;
  };
  let lattice = '';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 3; col++) {
      lattice += star(14 + col * 16, 16 + row * 22, 11);
      if (col < 2) lattice += star(22 + col * 16, 27 + row * 22, 7);
    }
  }
  return `<svg viewBox="0 0 60 170" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
    <defs><clipPath id="${id}"><path d="M0 0 H60 V132 L30 168 L0 132 Z"/></clipPath></defs>
    <path d="M0 0 H60 V132 L30 168 L0 132 Z" fill="${ink}"/>
    <g clip-path="url(#${id})" fill="none" stroke="${gold}" stroke-width=".9" opacity=".75">
      ${lattice}
    </g>
    <path d="M3 0 V130.5 L30 163 L57 130.5 V0" fill="none" stroke="${gold}" stroke-width="1.3"/>
    <path d="M5.6 0 V129.2 L30 158.5 L54.4 129.2 V0" fill="none" stroke="${gold}"
      stroke-width=".5" opacity=".8"/>
  </svg>`;
}

// حليةٌ هندسيةٌ في ذيل الصفحة الداخلية (ملاحظة ٣٥٠)
export function footOrnamentSvg(gold) {
  return `<svg viewBox="0 0 120 10" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g fill="none" stroke="${gold}" stroke-width=".7" opacity=".85">
      <path d="M0 5 H42"/><path d="M78 5 H120"/>
      <polygon points="60,0.6 64.6,5 60,9.4 55.4,5"/>
      <polygon points="50,2.2 53,5 50,7.8 47,5"/>
      <polygon points="70,2.2 73,5 70,7.8 67,5"/>
    </g></svg>`;
}

// ---------------------------------------------------------------------
// شريطُ المعاينة: يُري الصفحاتِ ويُوسم المشكوكُ فيها (ملاحظة ٣١١)
// ---------------------------------------------------------------------
function addPreviewBar(ctx, sheets, winH) {
  const { d, w, el } = ctx;
  const bar = el('div', 'prev-bar');
  const info = el('span', 'prev-info', `${AR(sheets.length)} صفحة`);

  // أرملةٌ أو أيتيمٌ أو بياضٌ كبيرٌ في الذيل
  let flagged = 0;
  for (const s of sheets) {
    // الغلافُ وصفحةُ العنوان بياضُهما مقصود، فلا يُوسمان
    if (s.classList.contains('cover-sheet') || s.classList.contains('div-sheet')
        || s.classList.contains('plain-sheet')) continue;
    const win = s.querySelector('.win');
    if (!win) continue;
    const kids = [...win.children];
    if (!kids.length) continue;
    const last = kids[kids.length - 1].getBoundingClientRect();
    const box = win.getBoundingClientRect();
    const gap = box.bottom - last.bottom;
    let hit = false;
    if (gap > mm2px(winH) * 0.35) { s.classList.add('flag-gap'); hit = true; }
    if (kids.length === 1 && last.height < mm2px(14)) { s.classList.add('flag-thin'); hit = true; }
    if (hit) flagged++;          // الصفحةُ تُعدُّ مرةً ولو اجتمع فيها الأمران
  }

  const grid = el('button', 'btn', 'شبكةُ الصفحات');
  grid.onclick = () => d.body.classList.toggle('grid-view');

  const print = el('button', 'btn primary', '🖨 صدِّرْ PDF');
  print.disabled = true;
  print.textContent = '⏳ تُحمَّل الصور…';
  print.onclick = () => { d.body.classList.remove('grid-view'); setTimeout(() => w.print(), 150); };

  const sizeMinus = el('button', 'btn', 'ـأ');
  const sizePlus = el('button', 'btn', 'أـ');
  let fs = 100;
  const applyFs = () => {
    d.documentElement.style.setProperty('--fs', `${fs}%`);
    info.textContent = `${AR(sheets.length)} صفحة · حجمُ الخطّ ${AR(fs)}٪`
      + (flagged ? ` · ${AR(flagged)} صفحةً للنظر` : '');
  };
  sizeMinus.onclick = () => { fs = Math.max(80, fs - 2); applyFs(); };
  sizePlus.onclick = () => { fs = Math.min(130, fs + 2); applyFs(); };

  bar.append(info, sizeMinus, sizePlus, grid, print);
  d.body.append(bar);
  applyFs();

  // لا يُطبَع قبل أن تُحمَّل الصورُ كلُّها، وإلا خرج الغلافُ مربّعًا
  // رماديًّا والبسملةُ بياضًا (ملاحظة ٣٣٤)
  allImagesReady(d).then(() => {
    print.disabled = false;
    print.textContent = '🖨 صدِّرْ PDF';
  });
}

function allImagesReady(d) {
  const imgs = [...d.images];
  return Promise.all(imgs.map(im => (im.complete && im.naturalWidth)
    ? Promise.resolve()
    : new Promise(res => {
        const done = () => res();
        im.addEventListener('load', done, { once: true });
        im.addEventListener('error', done, { once: true });
        setTimeout(done, 8000);
      })));
}

// ---------------------------------------------------------------------
// أنماطُ المجمَّع — على التصميم القائم (ملاحظات ٣٠٤ و٣١١ و٣٣٦)
// ---------------------------------------------------------------------
function bookCss(S, M, winW, winH, F, tpl) {
  const g = tpl.cover.gold, ink = tpl.inner.ink, green = tpl.cover.ink;
  const paper = tpl.cover.paper || '#f5efe4';
  return `
  :root { --fs: 100%; }
  @page { size: ${S.w}mm ${S.h}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: ${ink};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-family: ${F.stack}; }
  .sheet { position: relative; width: ${S.w}mm; height: ${S.h}mm; overflow: hidden;
    background: ${tpl.inner.paper}; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  .win { position: absolute; top: ${M.top}mm; inset-inline-start: ${M.inner}mm;
    width: ${winW}mm; height: ${winH}mm; overflow: hidden;
    font-size: calc(${F.size}pt * var(--fs) / 100); line-height: ${F.line};
    text-align: justify; direction: ${F.dir}; unicode-bidi: plaintext; }
  #measure { position: absolute; visibility: hidden; top: -10000mm; inset-inline-start: 0;
    width: ${winW}mm; font-size: calc(${F.size}pt * var(--fs) / 100); line-height: ${F.line};
    direction: ${F.dir}; text-align: justify; }
  .bp { margin: 0 0 4mm; }
  .bp.muted { color: #8a8a8a; }
  .bp strong { font-weight: 700; }
  .kh2 { font-size: calc(${F.size + 2}pt * var(--fs) / 100); color: ${green};
    text-align: center; margin: 2mm 0 4mm; font-weight: 700; }
  .kh2::before, .kh2::after { content: ''; display: block; height: .3mm;
    background: ${g}; opacity: .5; margin: 2mm auto; width: 40mm; }
  .docno { margin-top: 4mm; font-size: 8pt; color: #8a7a5c; text-align: center; direction: ltr; }
  .sec-h { font-size: calc(${F.size + 5}pt * var(--fs) / 100); color: ${green};
    text-align: center; margin: 0 0 6mm; direction: rtl; }
  .intro-p { margin: 0 0 4mm; }

  /* شريطُ البسملةِ في صدر كلِّ خطبة — الكليشةُ الداخلية (ملاحظتا ٣٣٥ و٣٣٦) */
  .sbd { height: 15mm; margin: 0 0 4mm; overflow: hidden; border-radius: 1mm;
    border-bottom: .3mm solid ${g}; }
  .sbd img { width: 100%; height: 100%; object-fit: cover; object-position: center;
    display: block; }

  /* الغلاف (ملاحظات ٣٠٤ و٣١٠ و٣٣٦) */
  .cover-sheet { background: ${paper}; }
  .cover { position: absolute; inset: 0; overflow: hidden; }
  .cover-bg { position: absolute; left: 0; right: 0; bottom: 0; width: 100%;
    height: 34%; object-fit: cover; }
  .cover-pat { position: absolute; inset: 0; opacity: .07;
    background:
      radial-gradient(circle at 50% 50%, ${g} 0 1.1px, transparent 1.6px) 0 0/12mm 12mm,
      radial-gradient(circle at 50% 50%, ${g} 0 .8px, transparent 1.3px) 6mm 6mm/12mm 12mm; }
  .cover-marks { position: absolute; inset: 0; }
  .cover-marks .mk { position: absolute; }
  .cover-banner { position: absolute; top: ${tpl.cover.bannerTop ?? 26}mm; inset-inline: 0; display: flex;
    justify-content: center; }
  .cover-banner svg { width: ${tpl.cover.bannerW || 30}mm;
    height: ${Math.round(S.h * 0.34)}mm; display: block; }
  .cover-mid { position: absolute; inset-inline: ${M.outer}mm;
    top: ${Math.round(S.h * ((tpl.cover.titleY ?? 52) / 100))}mm; text-align: center; }
  .cover .ct { font-size: 28pt; font-weight: 700; color: ${green}; margin: 0;
    line-height: 1.5; letter-spacing: .4mm; }
  .cover .crule { width: 54mm; height: .5mm; background: ${g}; margin: 5mm auto; opacity: .85; }
  .cover .cs { font-size: 14pt; color: ${g}; font-weight: 700; }
  .cover .cs2 { margin-top: 2mm; font-size: 13pt; color: ${g}; }
  .cover .cy { margin-top: 5mm; font-size: 12pt; color: ${green}; opacity: .8; }
  .cover-foot { position: absolute; inset-inline: ${M.outer}mm; bottom: 10mm;
    display: flex; flex-direction: column; gap: 1.5mm; text-align: center;
    font-size: 8.5pt; color: ${green}; opacity: .75; }

  /* ظهرُ الكتاب: آخرُ صفحةٍ فيه (ملاحظة ٣٥٥) */
  .back-sheet { background: ${tpl.back?.paper || paper}; }
  .back { position: absolute; inset: 0; }
  .back-mark { position: absolute; top: 14mm; left: 0; right: 0; margin-inline: auto;
    width: ${Math.max(16, Number(tpl.back?.markW ?? 26))}mm; display: flex;
    justify-content: center; }
  .back-mid { position: absolute; top: 46%; inset-inline: ${M.outer + 6}mm;
    text-align: center; direction: rtl; }
  .back-blurb { margin: 0; font-size: 11pt; line-height: 1.9;
    color: ${tpl.back?.ink || green}; }
  .back-foot { position: absolute; inset-inline: ${M.outer}mm; bottom: 12mm;
    display: flex; flex-direction: column; gap: 1.5mm; text-align: center;
    font-size: 8.5pt; color: ${tpl.back?.ink || green}; opacity: .78; }
  .back-foot .isbn { font-size: 9pt; letter-spacing: .4mm; opacity: .9; }

  /* صورٌ ونصوصٌ حرّةٌ تُنثر على الصفحات (ملاحظة ٣٥٥) */
  .deco-mk { position: absolute; width: auto; z-index: 3; }
  .deco-tx { position: absolute; z-index: 4; direction: rtl; line-height: 1.7;
    unicode-bidi: plaintext; }

  /* البسملةُ وصفحةُ الحقوق */
  .plain-sheet { background: #fff; }
  .basmala { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; }
  .basmala .bsm { width: ${Math.min(90, S.w - 50)}mm; height: auto; }
  .colo { position: absolute; top: ${M.top}mm; inset-inline-start: ${M.inner}mm;
    width: ${winW}mm; font-size: 10.5pt; line-height: 2; direction: rtl; text-align: start; }
  .colo h2 { font-size: 14pt; color: ${green}; margin: 0 0 5mm;
    border-bottom: .4mm solid ${g}; padding-bottom: 2mm; }
  .colo p { margin: 0 0 4mm; }
  .colo .rights { border: .3mm solid #e3d9c8; border-radius: 2mm; padding: 4mm;
    background: #fbf8f2; font-size: 9.5pt; }
  .colo-qr { width: 22mm; height: 22mm; margin-top: 5mm; }

  /* صفحةُ عنوان الخطبة (ملاحظتا ٣٠٩ و٣٣٦) */
  .div-sheet { background: ${tpl.divider.paper}; }
  .divider { position: absolute; inset: 0; }
  .divider .banner { position: absolute; top: 0; inset-inline: 0; display: flex;
    justify-content: center; }
  .divider .banner svg { width: ${tpl.divider.bannerW || 34}mm;
    height: ${Math.round(S.h * 0.56)}mm; display: block; }
  .div-stamp { position: absolute; top: ${M.top - 10}mm; inset-inline-end: ${M.outer}mm;
    text-align: end; direction: rtl; font-size: 9.5pt; font-weight: 700;
    color: ${tpl.divider.ink}; line-height: 2; }
  .div-ghost { position: absolute; bottom: 0; inset-inline-end: 0; width: 55%;
    opacity: .12; }
  .div-mid { position: absolute; inset-inline: ${M.outer}mm;
    top: ${Math.round(S.h * ((tpl.divider.midY ?? 62) / 100))}mm; text-align: center; direction: rtl; }
  .div-mid .dl { font-size: 13pt; color: ${tpl.divider.ink}; letter-spacing: .6mm; }
  .div-mid .dt { font-size: 21pt; font-weight: 700; color: ${tpl.divider.ink};
    margin-top: 3mm; line-height: 1.5; }
  .div-mid .dl2 { margin-top: 9mm; font-size: 12pt; color: ${tpl.divider.ink};
    letter-spacing: .5mm; }
  .div-mid .dn { font-size: 16pt; font-weight: 700; color: ${tpl.divider.ink}; margin-top: 2mm; }
  .div-mid .drule { width: 46mm; height: .35mm; background: ${g}; margin: 8mm auto 4mm;
    opacity: .7; }
  .div-mid .dmeta { font-size: 10pt; color: ${tpl.divider.ink}; opacity: .7; line-height: 1.8; }

  /* الرأسُ والذيلُ والترقيم (ملاحظة ٣٣٦) */
  .runhead { position: absolute; top: ${M.top - 9}mm; inset-inline-start: ${M.inner}mm;
    width: ${winW}mm; display: flex; justify-content: space-between; font-size: 8pt;
    color: #8a7a5c; border-bottom: .3mm solid ${g}; padding-bottom: 1.2mm; opacity: .9;
    direction: rtl; }
  .pageno { position: absolute; bottom: ${Math.max(5, M.bottom - 12)}mm; inset-inline: 0;
    display: flex; justify-content: center; }
  .pageno .pno { display: inline-flex; align-items: center; justify-content: center;
    min-width: 8mm; height: 8mm; font-size: 9pt; color: ${ink};
    ${tpl.inner.pageno === 'plain'
      ? ''
      : tpl.inner.pageno === 'ornament'
        ? `border-top: .3mm solid ${g}; border-bottom: .3mm solid ${g}; padding: 0 3mm;`
        : `border-radius: 50%; border: .3mm solid ${g}; background: #fff9;`} }
  .foot-orn { position: absolute; bottom: ${Math.max(3, M.bottom - 16)}mm;
    inset-inline: ${M.inner}mm; display: flex; justify-content: center; }
  .foot-orn svg { width: 46mm; height: 4mm; }
  .div-sheet .pageno .pno { background: transparent; }

  /* الفهرس — صفوفٌ تُقطع فُرادى فلا تنكسر خليةٌ عن أختها (ملاحظة ٣٣٤) */
  .idx-row { display: flex; align-items: baseline; gap: 2mm; direction: rtl;
    font-size: 9.5pt; padding: 1.5mm 1mm; border-bottom: .2mm solid #eee6d8;
    text-align: start; }
  .idx-row .n  { width: 9mm; text-align: center; flex: none; color: #6b6257; }
  .idx-row .ti { flex: 1 1 auto; font-weight: 600; }
  .idx-row .kh { width: 38mm; flex: none; color: #4a5560; font-size: 9pt; }
  .idx-row .dt { width: 26mm; flex: none; color: #6b6257; font-size: 8.5pt;
    white-space: nowrap; direction: rtl; }
  .idx-row .pg { width: 11mm; flex: none; text-align: center; color: ${green}; }
  .idx-th { border-bottom: .5mm solid ${g}; color: #6b6257; font-weight: 600;
    font-size: 8.5pt; }
  .idx-th .ti, .idx-th .pg { font-weight: 600; color: #6b6257; }

  /* المعاينة على الشاشة (ملاحظة ٣١١) */
  @media screen {
    body { background: #d9d9d9; padding-bottom: 70px; }
    .sheet { margin: 14px auto; box-shadow: 0 2px 12px #0003; }
    .sheet.flag-gap { outline: 2px solid #d8a13a; }
    .sheet.flag-thin { outline: 2px solid #c05050; }
    body.grid-view #pages { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
    body.grid-view .sheet { transform: scale(.28); transform-origin: top center;
      margin: 0; width: ${S.w}mm; height: ${S.h}mm;
      max-height: ${S.h * 0.28}mm; margin-bottom: ${-S.h * 0.72}mm; }
    .prev-bar { position: fixed; inset-inline: 0; bottom: 0; display: flex; gap: 8px;
      align-items: center; justify-content: center; padding: 10px;
      background: #1a232d; color: #fff; z-index: 9; flex-wrap: wrap; }
    .prev-bar .btn { border: 1px solid #ffffff44; background: transparent; color: #fff;
      border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px; }
    .prev-bar .btn.primary { background: #bc9661; border-color: #bc9661; color: #1a232d;
      font-weight: 700; }
    .prev-bar .btn[disabled] { opacity: .55; cursor: progress; }
    .prev-info { font-size: 13px; opacity: .9; margin-inline-end: 8px; }
  }
  @media print {
    .prev-bar { display: none; }
    .sheet { margin: 0; box-shadow: none; outline: 0; height: ${S.h - 0.5}mm; }
  }`;
}

// ---------------------------------------------------------------------
// نسخةُ Word: البناءُ نفسُه، نصًّا حيًّا يُحرَّر (ملاحظة ٣٠٩)
// ---------------------------------------------------------------------
async function bookWord(rows, { year, lang, title, intro, tpl }) {
  const { loadDocx } = await import('./export.js');
  const { downloadBlob } = await import('./xlsx.js');
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = docx;
  const S = SIZES[tpl.size] || SIZES.book;
  const F = fontOf(lang);

  const p = (text, o = {}) => new Paragraph({
    alignment: o.align || AlignmentType.JUSTIFIED,
    spacing: { after: o.after ?? 140, line: Math.round(F.line * 240) },
    children: [new TextRun({ text, bold: !!o.bold, size: Math.round((o.size || F.size) * 2),
      color: o.color, font: o.font })],
    bidirectional: F.dir === 'rtl',
    pageBreakBefore: !!o.br
  });

  const kids = [
    p(title, { align: AlignmentType.CENTER, bold: true, size: 26, after: 200 }),
    p(`لخُطب ${rowsMosque(rows)} المترجمة إلى ${langName(lang)}`,
      { align: AlignmentType.CENTER, size: 14 }),
    p(`لعام ${ARY(year)}هـ`, { align: AlignmentType.CENTER, size: 13, after: 400 }),
    p('الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي — مشروعُ خادم الحرمين '
      + 'الشريفين لترجمة خطب الحرمين، بتنفيذ جامعة أمِّ القرى.',
      { align: AlignmentType.CENTER, size: 10 })
  ];
  if (intro) {
    kids.push(p('المقدمة', { align: AlignmentType.CENTER, bold: true, size: 18, br: true }));
    for (const s of intro.split(/\n{2,}/)) kids.push(p(s));
  }
  kids.push(p('الفهرس', { align: AlignmentType.CENTER, bold: true, size: 18, br: true }));
  rows.forEach((r, i) => kids.push(p(
    `${AR(i + 1)}. ${r.title}${r.khateeb ? ` — ${r.khateeb}` : ''}`
    + `${r.hijri_text ? ` (${r.hijri_text})` : ''}`, { after: 60 })));

  rows.forEach(r => {
    kids.push(p('موضـوع الخطبة:', { align: AlignmentType.CENTER, size: 12, br: true, after: 60 }));
    kids.push(p(r.title, { align: AlignmentType.CENTER, bold: true, size: 20, after: 200 }));
    if (r.khateeb) {
      kids.push(p('لفضيـلة الشيـخ', { align: AlignmentType.CENTER, size: 11, after: 40 }));
      kids.push(p(r.khateeb, { align: AlignmentType.CENTER, bold: true, size: 15, after: 200 }));
    }
    kids.push(p(`${r.sermon_type} من ${MOSQUE[r.mosque] || ''}`,
      { align: AlignmentType.CENTER, size: 10, after: 40 }));
    kids.push(p(r.hijri_text || (r.sermon_date ? fmtHijri(r.sermon_date) : ''),
      { align: AlignmentType.CENTER, size: 10, after: 40 }));
    kids.push(p(langName(lang), { align: AlignmentType.CENTER, size: 10, after: 200 }));

    const parts = splitKhutbas(r.body_html || '');
    parts.forEach((part, k) => {
      kids.push(p(`(${k === 0 ? 'الخطبةُ الأولى' : 'الخطبةُ الثانية'})`,
        { align: AlignmentType.CENTER, bold: true, size: F.size + 2,
          br: k === 0, after: 160 }));
      for (const s of part) kids.push(p(s.text));
    });
    if (r.doc_no) kids.push(p(r.doc_no, { align: AlignmentType.CENTER, size: 8, after: 200 }));
  });

  const doc = new Document({ sections: [{
    properties: { page: {
      size: { width: `${S.w}mm`, height: `${S.h}mm` },
      margin: { top: '20mm', bottom: '18mm', left: '16mm', right: '22mm' } } },
    children: kids
  }] });
  const name = `${title} — ${langName(lang)} ${ARY(year)}هـ`.replace(/[\\/:*?"<>|]/g, ' ');
  downloadBlob(await Packer.toBlob(doc), `${name}.docx`);
  toast('خرج ملفُّ Word.', 'ok');
}
