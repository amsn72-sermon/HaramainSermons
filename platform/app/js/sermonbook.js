// مجمَّعُ الخطب السنوي: يُبنى في المنصة على التصميم القائم
// (ملاحظات ٣٠٤ و٣٠٩ و٣١٠ و٣١١)
//
//   الغلافُ ثم البسملةُ ثم المقدمةُ ثم الفهرسُ، ثم صفحةُ عنوانٍ لكلِّ
//   خطبةٍ ومتنُها. والصفحاتُ تُقاس وتُقطع بأيدينا كما في كلِّ مُخرَجات
//   المنصة منذ ملاحظة ٢٧٤ — فلا يفيض شيءٌ ولا يُترك فراغٌ عبثًا.
//
//   ولا يُغيَّر من التصميم إلا الشعاران: الهيئةُ العامةُ الجديد،
//   وجامعةُ أمِّ القرى (ملاحظة ٣٠٤).
import { openSheetWindow, measureBlocks, flowBlocks, mm2px } from './sheetflow.js';
import { h, toast, busy, dialog, escapeHtml, fmtHijri } from './ui.js';
import { db } from './sb.js';
import { langName, langDir, MOSQUE } from './store.js';
import { qrDataUri } from './qr.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

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

// القالبُ الافتراضي: تصميمُك القائم كما هو (ملاحظة ٣١٠)
export const DEFAULT_TPL = () => ({
  size: 'book',
  cover: {
    bg: '/assets/cover-kaaba.jpg', fade: 55, pattern: true,
    marks: BOOK_MARKS.map(m => ({ ...m })),
    ink: '#1a4d3a', gold: '#b9975b'
  },
  divider: { paper: '#f5efe4', banner: true, ghost: true, ink: '#1a4d3a' },
  inner: { head: true, foot: true, ink: '#1d2b3a', gold: '#b9975b', paper: '#ffffff' },
  intro: ''
});

// ---------------------------------------------------------------------
// نافذةُ الإصدار: اللغةُ والمسجدُ والمقاسُ والقالب، ثم معاينة (٣١١)
// ---------------------------------------------------------------------
export async function bookDialog(year, section) {
  let langs = [];
  try { langs = await db.rpc('arch_book_langs', { p_year: year }) || []; } catch { langs = []; }
  if (!langs.length) return toast('لا نسخَ في هذا العام بعد.', 'bad');

  let tpl = DEFAULT_TPL();
  try {
    const saved = await db.rpc('book_template', { p_year: year });
    const t = Array.isArray(saved) ? saved[0] : saved;
    if (t && t.tpl) tpl = { ...tpl, ...t.tpl };
  } catch { /* الافتراضيُّ يكفي */ }

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

  const tplBtn = h('button.btn.sm', { type: 'button' }, '🖌 تصميمُ القالب');
  const tplName = h('span.small.muted');
  const syncTpl = () => {
    tplName.textContent = tpl.name ? `القالب: ${tpl.name}` : 'القالبُ الافتراضي';
  };
  syncTpl();
  tplBtn.onclick = async () => {
    const next = await templateDialog(tpl, year);
    if (next) { tpl = next; syncTpl(); }
  };

  const res = await dialog({
    title: `إصدارُ مجمَّع ${ARY(year)}هـ`,
    body: h('div.stack',
      h('p.small.muted', 'يُبنى المجمَّعُ من خطب العام: غلافٌ ثم بسملةٌ ثم مقدمةٌ ثم فهرس، '
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
      h('div.row.between.wrap', tplName, tplBtn)),
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

  tpl = { ...tpl, size: res.size, intro: res.intro };
  if (res.fmt === 'docx') return bookWord(rows, { year, ...res, tpl });
  if (!buildBook(rows, { year, ...res, tpl })) {
    toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
  }
}

// ---------------------------------------------------------------------
// تصميمُ القالب: ثلاثةُ أبوابٍ — الغلافُ وصفحةُ عنوان الخطبة والصفحاتُ
//   الداخلية. والافتراضيُّ لا يُمَسّ: من عدّل أنشأ قالبًا باسمه
//   (ملاحظة ٣١٠)
// ---------------------------------------------------------------------
async function templateDialog(cur, year) {
  const t = JSON.parse(JSON.stringify(cur));
  t.cover = t.cover || DEFAULT_TPL().cover;
  t.divider = t.divider || DEFAULT_TPL().divider;
  t.inner = t.inner || DEFAULT_TPL().inner;
  t.cover.marks = Array.isArray(t.cover.marks) && t.cover.marks.length
    ? t.cover.marks : BOOK_MARKS.map(m => ({ ...m }));

  const name = h('input', { value: t.name || '', 'aria-label': 'اسم القالب',
    placeholder: `قالبُ ${ARY(year)}هـ` });
  const forYear = h('input', { type: 'checkbox', checked: true, 'aria-label': 'لهذا العام' });
  const asDefault = h('input', { type: 'checkbox', 'aria-label': 'قالبٌ افتراضي' });

  const colorIn = (val, set) => {
    const i = h('input', { type: 'color', value: val, 'aria-label': 'لون' });
    i.oninput = () => set(i.value);
    return i;
  };
  const rangeIn = (val, min, max, set) => {
    const i = h('input', { type: 'range', min: String(min), max: String(max),
      value: String(val), 'aria-label': 'مقدار' });
    i.oninput = () => set(Number(i.value));
    return i;
  };
  const check = (on, label, set) => {
    const i = h('input', { type: 'checkbox', checked: on ? true : null, 'aria-label': label });
    i.onchange = () => set(i.checked);
    return h('label.check', i, h('span', label));
  };

  // خلفيةُ الغلاف: تُرفَع أو تُختار من المرفوعات (ملاحظة ٣١٠)
  const bgFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'صورةُ الغلاف' });
  const bgPrev = h('div.mark-prev');
  const drawBg = () => bgPrev.replaceChildren(t.cover.bg
    ? h('img', { src: t.cover.bg, alt: 'خلفيةُ الغلاف' })
    : h('span.small.muted', 'بلا صورة — أرضيةٌ سادة'));
  const bgUp = h('button.btn.xs', { type: 'button', onclick: () => bgFile.click() }, '⤒ ارفعْ صورة');
  bgFile.onchange = async () => {
    const f = bgFile.files?.[0]; if (!f) return;
    try {
      const { prepareMark } = await import('./photo.js');
      t.cover.bg = await prepareMark(f, 1400); drawBg();
    } catch (e) { toast(e.message, 'bad'); }
    bgFile.value = '';
  };
  const bgClear = h('button.btn.xs.ghost', { type: 'button',
    onclick: () => { t.cover.bg = null; drawBg(); } }, 'بلا صورة');
  drawBg();

  // شعاراتُ الغلاف: تُضاف وتُحذَف وتُحرَّك (ملاحظة ٣١٠)
  const markBox = h('div.stack');
  const markFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'ملفُّ الشعار' });
  markFile.onchange = async () => {
    const f = markFile.files?.[0]; if (!f) return;
    try {
      const { prepareMark } = await import('./photo.js');
      t.cover.marks.push({ src: await prepareMark(f, 600), x: 45, y: 6, h: 16 });
      drawMarks();
    } catch (e) { toast(e.message, 'bad'); }
    markFile.value = '';
  };
  const numIn = (m, key, label, min, max) => {
    const i = h('input', { type: 'number', value: String(m[key]), min: String(min),
      max: String(max), step: '0.5', 'aria-label': label });
    i.oninput = () => { m[key] = Number(i.value); };
    return h('label.field.sm', label, i);
  };
  function drawMarks() {
    markBox.replaceChildren(...(t.cover.marks.length ? t.cover.marks.map((m, i) =>
      h('div.row.between.wrap.mark-row',
        h('img.mark-thumb', { src: m.src, alt: '' }),
        h('div.row.wrap', { style: { gap: '6px' } },
          numIn(m, 'x', 'من اليمين ٪', 0, 95),
          numIn(m, 'y', 'من الأعلى ٪', 0, 95),
          numIn(m, 'h', 'الارتفاع مم', 5, 40)),
        h('button.btn.xs.ghost', { type: 'button',
          onclick: () => { t.cover.marks.splice(i, 1); drawMarks(); } }, 'احذفه')))
      : [h('p.small.muted', 'لا شعارات — أضِفْ أو أعِدِ الثلاثةَ الافتراضية.')]));
  }
  drawMarks();

  const res = await dialog({
    title: 'تصميمُ قالب المجمَّع',
    body: h('div.stack',
      h('p.small.muted', 'الأصلُ تصميمُ المجمَّع القائم. وما تعدّله هنا يُحفَظ قالبًا '
        + 'باسمه، والافتراضيُّ يبقى مرجعًا لا يُمَسّ.'),

      h('fieldset.stack', h('legend', 'الغلاف'),
        h('div.row.between.wrap', h('span.small.muted', 'صورةُ الخلفية'),
          h('div.row', bgUp, bgFile, bgClear)),
        h('div.row.wrap', { style: { gap: '6px' } }, COVER_BGS.map(([src, label]) => {
          const b = h('button.btn.xs' + (t.cover.bg === src ? '.primary' : ''),
            { type: 'button' }, label);
          b.onclick = () => { t.cover.bg = src; drawBg(); };
          return b;
        })),
        bgPrev,
        h('label.field', 'شدّةُ ظهور الصورة',
          rangeIn(t.cover.fade, 10, 100, v => { t.cover.fade = v; })),
        check(t.cover.pattern, 'نقشٌ باهتٌ خلفَ الغلاف', v => { t.cover.pattern = v; }),
        h('div.grid-2',
          h('label.field', 'لونُ العنوان', colorIn(t.cover.ink, v => { t.cover.ink = v; })),
          h('label.field', 'اللونُ الذهبي', colorIn(t.cover.gold, v => { t.cover.gold = v; }))),
        h('div.row.between.wrap', h('span.small.muted', 'الشعارات'),
          h('div.row',
            h('button.btn.xs', { type: 'button', onclick: () => markFile.click() }, '＋ شعار'),
            markFile,
            h('button.btn.xs.ghost', { type: 'button', onclick: () => {
              t.cover.marks = BOOK_MARKS.map(m => ({ ...m })); drawMarks();
            } }, 'الثلاثةُ الافتراضية'))),
        markBox),

      h('fieldset.stack', h('legend', 'صفحةُ عنوان الخطبة'),
        h('div.grid-2',
          h('label.field', 'لونُ الأرضية',
            colorIn(t.divider.paper, v => { t.divider.paper = v; })),
          h('label.field', 'لونُ الخطّ', colorIn(t.divider.ink, v => { t.divider.ink = v; }))),
        check(t.divider.banner, 'الرايةُ المزخرفة', v => { t.divider.banner = v; }),
        check(t.divider.ghost, 'صورةٌ شبحٌ في الزاوية', v => { t.divider.ghost = v; })),

      h('fieldset.stack', h('legend', 'الصفحاتُ الداخلية'),
        h('div.grid-2',
          h('label.field', 'لونُ الحبر', colorIn(t.inner.ink, v => { t.inner.ink = v; })),
          h('label.field', 'لونُ الحلية', colorIn(t.inner.gold, v => { t.inner.gold = v; }))),
        check(t.inner.head, 'كليشةٌ في رأس الصفحة', v => { t.inner.head = v; }),
        check(t.inner.foot, 'شريطٌ في الذيل مع الترقيم', v => { t.inner.foot = v; })),

      h('fieldset.stack', h('legend', 'حفظُ القالب'),
        h('label.field', 'اسمُ القالب', name),
        h('label.check', forYear, h('span', `يخصُّ عامَ ${ARY(year)}هـ`)),
        h('label.check', asDefault, h('span', 'اجعلْه الافتراضيَّ للأعوام كلِّها')))),
    buttons: [
      { label: 'احفظْ واستعملْه', kind: 'primary',
        validate: () => (name.value.trim().length > 1 ? true : 'اكتب اسمَ القالب'),
        value: () => ({ save: true, name: name.value.trim() }) },
      { label: 'استعملْه بلا حفظ', value: () => ({ save: false }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return null;

  if (res.save) {
    t.name = res.name;
    try {
      await db.rpc('save_book_template', { p_name: res.name, p_tpl: t,
        p_year: forYear.checked ? year : null, p_default: asDefault.checked });
      toast('حُفظ القالب.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }
  return t;
}

// ---------------------------------------------------------------------
// بناءُ المجمَّع: صفحاتٌ حقيقيةٌ تُقاس وتُقطع (ملاحظات ٣٠٩ و٣١٠ و٣١١)
// ---------------------------------------------------------------------
export function buildBook(rows, { year, lang, title, intro, tpl }) {
  const S = SIZES[tpl.size] || SIZES.book;
  const F = fontOf(lang);
  const rtl = F.dir === 'rtl';
  // الهامشُ الداخليُّ أوسعُ: الخيطُ يأكل منه (ملاحظة ٣١١)
  const M = { top: 20, bottom: 18, inner: 22, outer: 16 };
  const WIN_W = S.w - M.inner - M.outer;
  const WIN_H = S.h - M.top - M.bottom - 10;      // ١٠ مم لشريط الترقيم

  const ctx = openSheetWindow(bookCss(S, M, WIN_W, WIN_H, F, tpl),
    { lang, dir: 'rtl' });
  if (!ctx) return false;
  const { el, img, pages, measure, w, d } = ctx;

  const esc = escapeHtml;
  const sheet = (cls = '') => {
    const s = el('div', 'sheet' + (cls ? ' ' + cls : ''));
    pagesOut.push(s);
    return s;
  };
  const pagesOut = [];

  ctx.ready(() => {
    // ـــ ١) الغلاف (ملاحظة ٣٠٩)
    const cv = sheet('cover-sheet');
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
    const mid = el('div', 'cover-mid');
    mid.append(el('h1', 'ct', esc(title)));
    mid.append(el('div', 'cs', esc(`لخُطب ${rowsMosque(rows)} المترجمة`)));
    mid.append(el('div', 'cs2', esc(`إلى ${langName(lang)}`)));
    mid.append(el('div', 'cy', esc(`لعام ${ARY(year)}هـ`)));
    c.append(mid);
    cv.append(c);

    // ـــ ٢) صفحةُ البسملة
    const bs = sheet('plain-sheet');
    const bd = el('div', 'basmala');
    bd.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true">'
      + '<rect x="24" y="24" width="72" height="72" transform="rotate(45 60 60)"'
      + ` fill="none" stroke="${tpl.cover.gold}" stroke-width="2"/>`
      + `<text x="60" y="56" text-anchor="middle" font-size="13" fill="${tpl.cover.gold}">بسم الله</text>`
      + `<text x="60" y="74" text-anchor="middle" font-size="13" fill="${tpl.cover.gold}">الرحمن الرحيم</text>`
      + '</svg>';
    bs.append(bd);

    // ـــ ٣) صفحةُ الحقوق
    const co = sheet('plain-sheet');
    const cob = el('div', 'colo');
    cob.innerHTML = `<h2>${esc(title)}</h2>`
      + `<p>لخُطب ${esc(rowsMosque(rows))} المترجمة إلى ${esc(langName(lang))}`
      + ` لعام ${esc(ARY(year))}هـ.</p>`
      + '<p>الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي — '
      + 'مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين، بتنفيذ جامعة أمِّ القرى.</p>'
      + `<div class="rights">حقوقُ الطبع محفوظة. ويُرجَع إلى أصلِ كلِّ خطبةٍ في المنصة`
      + ` برقم توثيقها المطبوع في ذيل صفحتها.<br>عددُ الخطب: ${esc(AR(rows.length))}`
      + ` · أُصدر في ${esc(fmtHijri(new Date().toISOString().slice(0, 10)))}</div>`;
    const qr = d.createElement('img');
    qr.className = 'colo-qr';
    qr.src = qrDataUri(`https://haramainsermons.com/verify?doc=${encodeURIComponent(
      rows[0]?.doc_no || '')}`, { margin: 1, dark: tpl.inner.ink });
    cob.append(qr);
    co.append(cob);

    // ـــ ٤) المقدمة (تُدرَج إن كُتبت)
    if (intro) {
      const blocks = intro.split(/\n{2,}/).filter(Boolean)
        .map(p => ({ html: `<p class="intro-p">${esc(p)}</p>` }));
      blocks.unshift({ html: '<h1 class="sec-h">المقدمة</h1>', keep: 24 });
      measureBlocks(w, measure, blocks);
      flowBlocks(blocks, mm2px(WIN_H), () => {
        const s = sheet();
        const win = el('div', 'win');
        s.append(win);
        return win;
      });
    }

    // ـــ ٥) الفهرس
    const idx = [{ html: '<h1 class="sec-h">الفهرس</h1>', keep: 24 },
      { html: '<table class="idx"><thead><tr><th>م</th><th>موضوع الخطبة</th>'
          + '<th>الخطيب</th><th>التاريخ</th><th>الصفحة</th></tr></thead></table>' }];
    const idxRows = rows.map((r, i) => ({
      html: `<table class="idx"><tbody><tr><td class="n">${AR(i + 1)}</td>`
        + `<td>${esc(r.title)}</td><td>${esc(r.khateeb || '—')}</td>`
        + `<td class="dt">${esc(r.hijri_text || (r.sermon_date ? fmtHijri(r.sermon_date) : '—'))}</td>`
        + `<td class="pg" data-seq="${i}">…</td></tr></tbody></table>`
    }));
    const idxAll = idx.concat(idxRows);
    measureBlocks(w, measure, idxAll);
    flowBlocks(idxAll, mm2px(WIN_H), () => {
      const s = sheet();
      const win = el('div', 'win');
      s.append(win);
      return win;
    });

    // ـــ ٦) الخطب: صفحةُ عنوانٍ ثم متن
    const pageOfSermon = [];
    rows.forEach((r, i) => {
      // صفحةُ العنوان (ملاحظة ٣٠٩)
      const ds = sheet('div-sheet');
      const dv = el('div', 'divider');
      if (tpl.divider.banner) {
        const bn = el('div', 'banner');
        bn.innerHTML = bannerSvg(tpl.divider.ink, tpl.cover.gold);
        dv.append(bn);
      }
      if (tpl.divider.ghost && tpl.cover.bg) {
        const g = img(tpl.cover.bg, 'div-ghost');
        dv.append(g);
      }
      const dm = el('div', 'div-mid');
      dm.innerHTML = '<div class="dl">موضـوع الخطبة:</div>'
        + `<div class="dt">${esc(r.title)}</div>`
        + (r.khateeb ? '<div class="dl2">لفضيـلة الشيـخ</div>'
            + `<div class="dn">${esc(r.khateeb)}</div>` : '')
        + '<div class="drule"></div>'
        + `<div class="dmeta">${esc(r.sermon_type)} من ${esc(MOSQUE[r.mosque] || '')}</div>`
        + `<div class="dmeta">${esc(langName(lang))}</div>`
        // العنوانُ ثم اللغةُ ثم التاريخ، والهجريُّ وحدَه (ملاحظتا ٣٠٩ و١٦٠)
        + `<div class="dmeta">${esc(r.hijri_text
            || (r.sermon_date ? fmtHijri(r.sermon_date) : ''))}</div>`;
      dv.append(dm);
      ds.append(dv);

      // المتن: يبدأ من أوّل سطرٍ في الصفحة التالية (ملاحظة ٣٠٩)
      pageOfSermon[i] = pagesOut.length + 1;
      const parts = splitKhutbas(r.body_html || '');
      const blocks = [];
      parts.forEach((part, k) => {
        blocks.push({ kind: 'head', keep: mm2px(18),
          html: `<h2 class="kh">(${k === 0 ? 'الخطبةُ الأولى' : 'الخطبةُ الثانية'})</h2>` });
        for (const p of part) {
          blocks.push({ html: `<p class="bp">${esc(p)}</p>` });
        }
      });
      if (!blocks.length) blocks.push({ html: '<p class="bp muted">لا نصَّ محفوظٌ لهذه النسخة.</p>' });
      blocks.push({ html: `<div class="docno" dir="ltr">${esc(r.doc_no || '')}</div>` });

      measureBlocks(w, measure, blocks);
      let used = 0, box = null;
      const next = () => {
        const s = sheet();
        const win = el('div', 'win');
        s.append(win);
        used = 0;
        return win;
      };
      box = next();
      for (const b of blocks) {
        // «الخطبةُ الثانية» تتبع الأولى إن بقي أكثرُ من نصف الصفحة،
        //   وإلا انتقلت إلى رأس التالية (ملاحظة ٣٠٩)
        const half = mm2px(WIN_H) / 2;
        if (b.kind === 'head' && used > 0 && (mm2px(WIN_H) - used) <= half) {
          box = next();
        } else if (used + b.h + (b.keep || 0) > mm2px(WIN_H) && used > 0) {
          box = next();
        }
        box.insertAdjacentHTML('beforeend', b.html);
        used += b.h;
      }
    });

    // أرقامُ الصفحات، والفهرسُ يُملأ بها
    pagesOut.forEach((s, i) => {
      if (s.classList.contains('cover-sheet')) return;
      const n = el('div', 'pageno');
      n.innerHTML = `<span class="pno">${AR(i + 1)}</span>`;
      s.append(n);
      if (tpl.inner.head && !s.classList.contains('plain-sheet')
          && !s.classList.contains('div-sheet')) {
        const hd = el('div', 'runhead');
        hd.innerHTML = `<span>${esc(title)}</span>`
          + `<span>${esc(`لعام ${ARY(year)}هـ`)}</span>`;
        s.append(hd);
      }
    });
    pages.replaceChildren(...pagesOut);
    // الفهرسُ يُملأ بعد أن تستقرَّ الصفحاتُ في الوثيقة
    d.querySelectorAll('.idx .pg[data-seq]').forEach(td => {
      const i = Number(td.getAttribute('data-seq'));
      td.textContent = AR(pageOfSermon[i] || 0);
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

// فصلُ الخطبة الأولى عن الثانية: العبارةُ المعتادةُ في المتن
function splitKhutbas(html) {
  const text = String(html).replace(/<[^>]*>/g, '\n');
  const paras = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const mark = /^\(?\s*(الخطبة|الخُطبة)\s*(الثانية|الثانيه)\s*\)?\s*$/;
  const out = [[]];
  for (const p of paras) {
    if (mark.test(p)) { out.push([]); continue; }
    if (/^\(?\s*(الخطبة|الخُطبة)\s*(الأولى|الاولى)\s*\)?\s*$/.test(p)) continue;
    out[out.length - 1].push(p);
  }
  return out.filter(a => a.length);
}

function bannerSvg(ink, gold) {
  return `<svg viewBox="0 0 60 150" aria-hidden="true">
    <path d="M0 0 H60 V120 L30 150 L0 120 Z" fill="${ink}"/>
    <path d="M4 4 H56 V118 L30 144 L4 118 Z" fill="none" stroke="${gold}" stroke-width="1.2"/>
    <g fill="none" stroke="${gold}" stroke-width="1" opacity=".85">
      <rect x="16" y="22" width="28" height="28"/>
      <rect x="16" y="22" width="28" height="28" transform="rotate(45 30 36)"/>
      <rect x="16" y="66" width="28" height="28"/>
      <rect x="16" y="66" width="28" height="28" transform="rotate(45 30 80)"/>
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
  print.onclick = () => { d.body.classList.remove('grid-view'); setTimeout(() => w.print(), 120); };

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
}

// ---------------------------------------------------------------------
// أنماطُ المجمَّع — على التصميم القائم (ملاحظتا ٣٠٤ و٣١١)
// ---------------------------------------------------------------------
function bookCss(S, M, winW, winH, F, tpl) {
  const g = tpl.cover.gold, ink = tpl.inner.ink, green = tpl.cover.ink;
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
    width: ${winW}mm; font-size: calc(${F.size}pt * var(--fs) / 100); line-height: ${F.line}; }
  .bp { margin: 0 0 4mm; }
  .bp.muted { color: #8a8a8a; }
  .kh { font-size: calc(${F.size + 2}pt * var(--fs) / 100); color: ${green};
    text-align: center; margin: 2mm 0 4mm; font-weight: 700; }
  .kh::before, .kh::after { content: ''; display: block; height: .3mm;
    background: ${g}; opacity: .5; margin: 2mm auto; width: 40mm; }
  .docno { margin-top: 4mm; font-size: 8pt; color: #8a7a5c; text-align: center; direction: ltr; }
  .sec-h { font-size: calc(${F.size + 5}pt * var(--fs) / 100); color: ${green};
    text-align: center; margin: 0 0 6mm; }
  .intro-p { margin: 0 0 4mm; text-indent: 0; }

  /* الغلاف (ملاحظتا ٣٠٤ و٣١٠) */
  .cover-sheet { background: #fff; }
  .cover { position: absolute; inset: 0; overflow: hidden; }
  .cover-bg { position: absolute; left: 0; right: 0; bottom: 0; width: 100%;
    height: 58%; object-fit: cover;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 32%);
    mask-image: linear-gradient(to bottom, transparent, #000 32%); }
  .cover-pat { position: absolute; inset: 0; opacity: .05;
    background: radial-gradient(circle at 30% 20%, ${g} 0 2px, transparent 3px) 0 0/18mm 18mm; }
  .cover-marks { position: absolute; inset: 0; }
  .cover-marks .mk { position: absolute; }
  .cover-mid { position: absolute; inset-inline: ${M.outer}mm; top: 28%;
    text-align: center; }
  .cover .ct { font-size: 30pt; font-weight: 700; color: ${green}; margin: 0;
    line-height: 1.4; }
  .cover .cs { margin-top: 6mm; font-size: 14pt; color: ${g}; font-weight: 700; }
  .cover .cs2 { margin-top: 2mm; font-size: 13pt; color: ${g}; }
  .cover .cy { margin-top: 4mm; font-size: 12pt; color: #5a6a78; }

  /* البسملةُ وصفحةُ الحقوق */
  .plain-sheet { background: #fff; }
  .basmala { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; }
  .basmala svg { width: 70mm; height: 70mm; }
  .colo { position: absolute; top: ${M.top}mm; inset-inline-start: ${M.inner}mm;
    width: ${winW}mm; font-size: 10.5pt; line-height: 2; }
  .colo h2 { font-size: 14pt; color: ${green}; margin: 0 0 5mm;
    border-bottom: .4mm solid ${g}; padding-bottom: 2mm; }
  .colo p { margin: 0 0 4mm; }
  .colo .rights { border: .3mm solid #e3d9c8; border-radius: 2mm; padding: 4mm;
    background: #fbf8f2; font-size: 9.5pt; }
  .colo-qr { width: 22mm; height: 22mm; margin-top: 5mm; }

  /* صفحةُ عنوان الخطبة (ملاحظة ٣٠٩) */
  .div-sheet { background: ${tpl.divider.paper}; }
  .divider { position: absolute; inset: 0; }
  .divider .banner { position: absolute; top: 0; inset-inline-start: ${M.inner}mm;
    width: 26mm; }
  .divider .banner svg { width: 100%; height: auto; display: block; }
  .div-ghost { position: absolute; bottom: 0; inset-inline-end: 0; width: 55%;
    opacity: .12;
    -webkit-mask-image: linear-gradient(to top, #000 35%, transparent 100%);
    mask-image: linear-gradient(to top, #000 35%, transparent 100%); }
  .div-mid { position: absolute; inset-inline: ${M.outer}mm; top: 46%;
    text-align: center; }
  .div-mid .dl { font-size: 12pt; color: ${green}; }
  .div-mid .dt { font-size: 22pt; font-weight: 700; color: ${green}; margin-top: 2mm; }
  .div-mid .dl2 { margin-top: 8mm; font-size: 11pt; color: ${green}; }
  .div-mid .dn { font-size: 16pt; font-weight: 700; color: ${green}; margin-top: 1mm; }
  .div-mid .drule { width: 46mm; height: .35mm; background: ${g}; margin: 8mm auto 4mm;
    opacity: .7; }
  .div-mid .dmeta { font-size: 10pt; color: #6b6257; line-height: 1.8; }

  /* الرأسُ والذيلُ والترقيم */
  .runhead { position: absolute; top: ${M.top - 9}mm; inset-inline-start: ${M.inner}mm;
    width: ${winW}mm; display: flex; justify-content: space-between; font-size: 8pt;
    color: #8a7a5c; border-bottom: .3mm solid ${g}; padding-bottom: 1.2mm; opacity: .9; }
  .pageno { position: absolute; bottom: ${M.bottom - 12}mm; inset-inline: 0;
    display: flex; justify-content: center; }
  .pageno .pno { display: inline-flex; align-items: center; justify-content: center;
    width: 8mm; height: 8mm; border-radius: 50%; border: .3mm solid ${g};
    font-size: 9pt; color: ${ink}; }

  /* الفهرس */
  table.idx { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.idx th { color: #6b6257; font-weight: 600; font-size: 8.5pt;
    border-bottom: .4mm solid ${g}; padding: 1.5mm 1mm; text-align: start; }
  table.idx td { border-bottom: .2mm solid #eee6d8; padding: 1.4mm 1mm; }
  table.idx td.n, table.idx td.pg { text-align: center; width: 10mm; }
  table.idx td.dt { white-space: nowrap; font-size: 8.5pt; color: #6b6257; }

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
  const { Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak, HeadingLevel } = docx;
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
      for (const s of part) kids.push(p(s));
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
