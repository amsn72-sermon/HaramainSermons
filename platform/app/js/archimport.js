// الرفعُ الجماعيُّ لخطب العام من ملفٍ واحد (ملاحظة ٣٠٥)
//
//   عندَ صاحبِ المشروع مجمَّعاتٌ سنويةٌ من ١٤٤٤ إلى ١٤٤٧، كلُّ ملفٍ
//   فيه خطبُ عامٍ متتابعةً، وقبلَ كلِّ خطبةٍ في متنِها تاريخُها
//   ومسجدُها وخطيبُها ولغتُها. فنقرأ الملفَ في المتصفح، ونشقُّه عند
//   مطالع الخطب، ونستنبطُ ما في مطلعِ كلِّ خطبةٍ، ثم نَعرض ذلك جدولَ
//   مراجعةٍ يُصحَّح فيه ما أخطأ الاستنباطُ — ولا يُكتب في الأرشيف شيءٌ
//   حتى يُعتمدَ الجدول. وما اتّفق تاريخُه ومسجدُه ضُمَّ في خطبةٍ
//   واحدةٍ تتعدّد نسخُها باللغات، فلا تتكرّر الجمعةُ لأنّ لغتَها
//   جاءت في ملفٍ آخر.
import { h, dialog, toast } from './ui.js';
import { db } from './sb.js';
import { state, MOSQUE, SERMON_TYPES, langByName } from './store.js';
import { readDocxParagraphs } from './docxread.js';
import { setSafeHtml } from './sanitize.js';

// ---------------------------------------------------------------------
// ١) التواريخُ: الهجريُّ كما كُتب، والميلاديُّ ليُحسَب به الأسبوع
// ---------------------------------------------------------------------
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
const digits = s => String(s ?? '').replace(/[٠-٩۰-۹]/g, c => AR_DIGITS[c] || c);
const ARY = n => Number(n || 0).toLocaleString('ar-SA', { useGrouping: false });

const H_MONTHS = [
  ['محرم', 'محرّم'],
  ['صفر'],
  ['ربيع الاول', 'ربيع الأول', 'ربيعالاول'],
  ['ربيع الثاني', 'ربيع الاخر', 'ربيع الآخر'],
  ['جمادى الاولى', 'جمادى الأولى', 'جمادي الاولى'],
  ['جمادى الاخرة', 'جمادى الآخرة', 'جمادى الثانية', 'جمادي الثانيه'],
  ['رجب'],
  ['شعبان'],
  ['رمضان'],
  ['شوال', 'شوّال'],
  ['ذو القعدة', 'ذي القعدة', 'ذوالقعدة', 'ذو القعده'],
  ['ذو الحجة', 'ذي الحجة', 'ذوالحجة', 'ذو الحجه'],
];
const bare = s => String(s ?? '').replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();

const hijriMonth = name => {
  const k = bare(name);
  for (let i = 0; i < H_MONTHS.length; i++) {
    if (H_MONTHS[i].some(a => bare(a) === k || k.includes(bare(a)))) return i + 1;
  }
  return 0;
};

const hFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',
  { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const hParts = d => {
  const o = {};
  for (const p of hFmt.formatToParts(d)) o[p.type] = p.value;
  return { y: Number(String(o.year).replace(/\D/g, '')), m: Number(o.month), d: Number(o.day) };
};

// هجريٌّ ← ميلاديٌّ: تقديرٌ حسابيٌّ ثم تصحيحٌ بتقويم أم القرى
export function hijriToDate(y, m, d) {
  if (!y || !m || !d) return null;
  const jd = d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354
    + Math.floor((3 + 11 * y) / 30) + 1948439.5 - 1;
  const t = (jd - 2440587.5) * 86400000;
  for (let k = -4; k <= 4; k++) {
    const dt = new Date(t + k * 86400000);
    const p = hParts(dt);
    if (p.y === y && p.m === m && p.d === d) return dt;
  }
  for (let k = -8; k <= 8; k++) {
    const dt = new Date(t + k * 86400000);
    const p = hParts(dt);
    if (p.y === y && p.m === m) return dt;
  }
  return new Date(t);
}

export const ymd = dt => (dt instanceof Date && !isNaN(dt)
  ? `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  : '');

// نصٌّ ← { date, hijri_text } إن وُجد فيه تاريخٌ هجريٌّ أو ميلادي
export function findDate(text, defYear) {
  const raw = String(text || '');
  const t = digits(raw);

  // «٧ محرم ١٤٤٦هـ» أو «٧ من ربيع الأول سنة ١٤٤٦»: الشهرُ كلمةٌ أو كلمتان،
  // ولا يُقبل التاريخُ إلا بسنةٍ أو بعلامةِ الهجرة، كي لا يُحسَب كلُّ رقمٍ تاريخًا
  const mh = t.match(/(\d{1,2})\s*(?:من\s+)?([ء-ْ]+(?:\s+[ء-ْ]+)?)\s*(?:سنة\s*)?(\d{3,4})?\s*(هـ|هجري|ه)?/);
  if (mh && (mh[3] || mh[4])) {
    const mon = hijriMonth(mh[2]);
    const yr = Number(mh[3] || defYear || 0);
    const day = Number(mh[1]);
    if (mon && yr >= 1300 && yr <= 1600 && day >= 1 && day <= 30) {
      const dt = hijriToDate(yr, mon, day);
      if (dt) return { date: ymd(dt), hijri_text: raw.trim().slice(0, 80) };
    }
  }
  // ميلاديّ: ١٢/٧/٢٠٢٤ أو ٢٠٢٤-٠٧-١٢
  const iso = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const dt = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    if (!isNaN(dt)) return { date: ymd(dt), hijri_text: '' };
  }
  const sl = t.match(/(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{4})/);
  if (sl) {
    const y = +sl[3];
    if (y >= 1300 && y <= 1600) {
      const dt = hijriToDate(y, +sl[2], +sl[1]);
      if (dt) return { date: ymd(dt), hijri_text: raw.trim().slice(0, 80) };
    }
    const dt = new Date(Date.UTC(y, +sl[2] - 1, +sl[1]));
    if (!isNaN(dt)) return { date: ymd(dt), hijri_text: '' };
  }
  return null;
}

// ---------------------------------------------------------------------
// ٢) الشقُّ: أين تبدأ كلُّ خطبة
// ---------------------------------------------------------------------
const MOSQUE_RE = /المسجد\s*(الحرام|النبوي)/;
const HEAD_RE = /^(خطبة|خطبه|الخطبة)\s/;
const KHATEEB_RE = /(?:فضيلة\s+)?(?:الشيخ|الدكتور|الخطيب|خطيب[ُاً]?\s+المسجد)\s*[:\-–]?\s*(.{3,60})$/;
const LANG_RE = /^(?:اللغة|اللغه|ترجمة|الترجمة|بلغة)\s*[:\-–]?\s*(.{2,30})$/;
const FIRST_KH = /(الخطبة\s*الأولى|الخطبه\s*الاولى)/;

const mosqueOf = text => {
  const m = String(text || '').match(MOSQUE_RE);
  if (!m) return '';
  return m[1].startsWith('الحرام') ? 'makkah' : 'madinah';
};

const typeOf = text => SERMON_TYPES.find(t => bare(text).includes(bare(t))) || '';

// فقراتٌ ← خطبٌ: [{ mosque, title, khateeb, lang, date, hijri_text, html, words }]
export function splitSermons(paras, { year, fileLang } = {}) {
  const out = [];
  let cur = null;
  const isHead = p => {
    const t = p.text;
    if (!t) return false;
    if (MOSQUE_RE.test(t) && t.length <= 90 && (HEAD_RE.test(t) || p.bold || p.align === 'center' || p.heading)) return true;
    // صفحةٌ قُطعت وبعدها سطرٌ قصيرٌ فيه تاريخٌ أو مسجد
    if (p.breakBefore && t.length <= 120 && (findDate(t, year) || MOSQUE_RE.test(t))) return true;
    return false;
  };

  paras.forEach(p => {
    if (isHead(p) && (!cur || cur.body.length)) {
      cur = { head: [], body: [], words: 0 };
      out.push(cur);
    }
    if (!cur) { cur = { head: [], body: [], words: 0 }; out.push(cur); }
    // المطلعُ: ما قبل «الخطبة الأولى» أو أوّلُ ستِّ فقراتٍ قصيرة
    const short = p.text.length <= 140;
    if (!cur.started && (cur.head.length < 8 && short && !FIRST_KH.test(p.text))) cur.head.push(p);
    else { cur.started = true; if (p.text) { cur.body.push(p); cur.words += p.text.split(/\s+/).length; } }
  });

  return out.filter(s => s.body.length || s.head.length > 1).map(s => {
    const heads = s.head.map(p => p.text).filter(Boolean);
    const joined = heads.join(' • ');
    let mosque = '', khateeb = '', lang = '', date = '', hijri = '', type = '';
    const left = [];
    for (const t of heads) {
      // سطرُ المسجد ليس عنوانًا، وإن تكرّر في غلافٍ وفي مطلعِ الخطبة
      if (MOSQUE_RE.test(t)) {
        if (!mosque) mosque = mosqueOf(t);
        if (!type) type = typeOf(t);
        const dm = !date && findDate(t, year);
        if (dm) { date = dm.date; hijri = dm.hijri_text; }
        continue;
      }
      const d = !date && findDate(t, year);
      if (d) { date = d.date; hijri = d.hijri_text; continue; }
      const lm = t.match(LANG_RE);
      if (lm && !lang) { const c = langByName(lm[1]); if (c) { lang = c; continue; } }
      const km = t.match(KHATEEB_RE);
      if (km && !khateeb) { khateeb = km[1].replace(/[«»"]/g, '').trim(); continue; }
      if (!lang) { const c = langByName(t); if (c) { lang = c; continue; } }
      left.push(t);
    }
    if (!mosque) mosque = mosqueOf(joined);
    if (!type) type = typeOf(joined) || 'خطبة جمعة';
    if (!date) { const d = findDate(joined, year); if (d) { date = d.date; hijri = d.hijri_text; } }
    const title = (left.find(t => t.length >= 6 && t.length <= 120)
      || left[0] || heads.find(t => !mosqueOf(t)) || '').replace(/^[«"]|[»"]$/g, '').trim();
    return {
      mosque, title, khateeb, date, hijri_text: hijri, type,
      lang: lang || fileLang || '',
      html: s.body.map(p => p.html).filter(Boolean).join('\n'),
      words: s.words,
      head: heads,
    };
  }).filter(s => s.html || s.title);
}

// ---------------------------------------------------------------------
// ٣) نافذةُ الرفع: اختيارُ الملفات، ثم جدولُ المراجعة، ثم الاعتماد
// ---------------------------------------------------------------------
export async function importDialog({ sectionId, year, onDone }) {
  const langs = state.languages || [];
  const pick = h('input', { type: 'file', multiple: true, accept: '.docx' });
  const fileLang = h('select', { 'aria-label': 'لغةُ الملفات' },
    h('option', { value: '' }, 'تُستنبط من المتن'),
    ...langs.map(l => h('option', { value: l.code }, l.name_ar)));

  const note = h('p.small.muted', 'لا يُكتب في الأرشيف شيءٌ حتى تعتمد الجدول.');
  let rows = [];

  const parse = async () => {
    rows = [];
    for (const f of [...pick.files]) {
      note.textContent = `نقرأ ${f.name}…`;
      const paras = await readDocxParagraphs(f);
      for (const r of splitSermons(paras, { year, fileLang: fileLang.value })) {
        rows.push({ ...r, file: f.name });
      }
    }
  };

  const res = await dialog({
    title: `رفعُ خطب ${ARY(year)}هـ من ملفات Word`,
    body: h('div.col.gap',
      h('p.small.muted', 'ارفع المجمَّع السنويَّ كما هو عندك: يُشقُّ عند مطالع الخطب، '
        + 'ويُستنبط من مطلع كلِّ خطبةٍ تاريخُها ومسجدُها وخطيبُها ولغتُها، '
        + 'ثم يُعرض عليك جدولُ مراجعةٍ تُصحِّح فيه ما شئت قبل الاعتماد.'),
      h('label.field', h('span', 'ملفاتُ Word (.docx)'), pick),
      h('label.field', h('span', 'لغةُ الملف إن لم تُذكر في المتن'), fileLang),
      note),
    buttons: [
      { label: 'اقرأ الملفات', kind: 'primary',
        validate: async () => {
          if (!pick.files?.length) return 'اختر ملفًا واحدًا على الأقل';
          try { await parse(); } catch (e) { note.textContent = ''; return e.message; }
          if (!rows.length) return 'لم تُعرَف في الملفات خطبةٌ — راجع تنسيقَها';
          return true;
        },
        value: () => true },
      { label: 'إلغاء', value: null },
    ],
  });
  if (!res) return;

  await reviewDialog({ sectionId, year, rows, onDone });
}

// جدولُ المراجعة: كلُّ صفٍّ يُصحَّح ويُستبعد
async function reviewDialog({ sectionId, year, rows, onDone }) {
  const langs = state.languages || [];
  const fields = [];

  const table = h('table.tbl.imp-tbl',
    h('thead', h('tr',
      h('th', '✓'), h('th', '#'), h('th', 'العنوان'), h('th', 'المسجد'),
      h('th', 'التاريخ'), h('th', 'الخطيب'), h('th', 'اللغة'),
      h('th', 'النوع'), h('th', 'كلمات'), h('th', 'المتن'))),
    h('tbody', ...rows.map((r, i) => {
      const f = {
        on: h('input', { type: 'checkbox', checked: !!(r.title && r.date), 'aria-label': `ضمِّ الصفَّ ${i + 1}` }),
        title: h('input', { value: r.title || '', 'aria-label': `عنوانُ الصفِّ ${i + 1}` }),
        mosque: h('select', { 'aria-label': `مسجدُ الصفِّ ${i + 1}` },
          h('option', { value: '' }, '—'),
          ...Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k, selected: r.mosque === k }, v))),
        date: h('input', { type: 'date', value: r.date || '', 'aria-label': `تاريخُ الصفِّ ${i + 1}` }),
        khateeb: h('input', { value: r.khateeb || '', 'aria-label': `خطيبُ الصفِّ ${i + 1}` }),
        lang: h('select', { 'aria-label': `لغةُ الصفِّ ${i + 1}` },
          h('option', { value: '' }, '—'),
          ...langs.map(l => h('option', { value: l.code, selected: r.lang === l.code }, l.name_ar))),
        type: h('select', { 'aria-label': `نوعُ الصفِّ ${i + 1}` },
          ...SERMON_TYPES.map(t => h('option', { value: t, selected: (r.type || 'خطبة جمعة') === t }, t))),
      };
      fields.push({ r, f });
      const peek = h('button.link.small', { type: 'button' }, 'استعرِض');
      peek.onclick = () => dialog({
        title: f.title.value || 'متنُ الخطبة',
        body: setSafeHtml(h('div.doc-peek', { dir: 'auto' }), r.html || '<p>لا متن</p>'),
        buttons: [{ label: 'إغلاق', value: null }],
      });
      return h('tr', { class: r.title && r.date ? '' : 'warn-row' },
        h('td', f.on), h('td.num', String(i + 1)),
        h('td', f.title), h('td', f.mosque), h('td', f.date),
        h('td', f.khateeb), h('td', f.lang), h('td', f.type),
        h('td.num', String(r.words || 0)), h('td', peek));
    })));

  const hint = h('p.small.muted',
    `${rows.length} خطبةً قُرئت. الصفوفُ المظلَّلةُ ناقصةُ العنوان أو التاريخ: أكملها أو استبعدها.`);

  let done = null;

  const collect = () => fields.filter(x => x.f.on.checked).map(({ r, f }) => ({
    sermon_date: f.date.value || null,
    hijri_text: r.hijri_text || null,
    mosque: f.mosque.value || null,
    title: f.title.value.trim(),
    khateeb: f.khateeb.value.trim() || null,
    sermon_type: f.type.value,
    versions: f.lang.value
      ? [{ language_code: f.lang.value, is_source: f.lang.value === 'ar',
           body_html: r.html || null, words: r.words || null }]
      : [],
  }));

  const out = await dialog({
    title: `مراجعةُ ما قُرئ — ${ARY(year)}هـ`,
    body: h('div.col.gap.imp-wrap', hint, h('div.scroll-x', table),
      h('p.small.muted', 'ما اتّفق تاريخُه ومسجدُه يُضَمُّ في خطبةٍ واحدةٍ تتعدّد لغاتُها.')),
    buttons: [
      { label: 'اعتمدْ واكتبْ في الأرشيف', kind: 'primary',
        validate: async () => {
          const items = collect();
          if (!items.length) return 'لم تَختر صفًّا واحدًا';
          const bad = items.filter(x => !x.sermon_date || !x.title).length;
          if (bad) return `${bad} صفًّا ناقصَ العنوان أو التاريخ — أكملْه أو استبعدْه`;
          try {
            done = await db.rpc('import_arch_sermons',
              { p: { section_id: sectionId, items } });
          } catch (e) { return e.message; }
          return true;
        },
        value: () => done },
      { label: 'إلغاء', value: null },
    ],
  });
  if (!out) return;

  toast(`كُتبت: ${out.created || 0} خطبةً جديدة، وضُمَّ ${out.merged || 0}، `
    + `و${out.versions || 0} نسخة`, 'ok');
  if (onDone) await onDone();
}

export default importDialog;
