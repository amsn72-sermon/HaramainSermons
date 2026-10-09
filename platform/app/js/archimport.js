// الرفعُ الجماعيُّ لخطب العام (ملاحظة ٣١٦)
//
//   مجمَّعاتُ الأعوام عند صاحب المشروع ملفُّ وورد لكلِّ لغة، وفي كلِّ
//   ملفٍّ ترويسةٌ عربيةٌ قبل كلِّ خطبة — هكذا هي في الواقع:
//
//       ترجمة خطبة الجمعة بالمسجد الحرام (اللغة البنغالية)
//       التاريخ: 14/01/1444هـ الموافق 12/08/2022م
//       الخطيب: فضيلة الشيخ/ الدكتور عبد الله عواد الجهني
//       الموضوع: احرص على ما ينفعك
//
//   وبعضُها يفتتح بالبسملة ثم سطرِ التاريخ. فلكلِّ ملفٍّ علامتُه التي
//   تُؤذن ببدء خطبةٍ جديدة، ونحن نُجرّب العلاماتِ كلَّها عليه ونختار
//   أضبطَها: أكثرَها تاريخًا وأقربَها إلى عدد جُمَع العام.
//
//   ومنها تُستخرج الأربعةُ التي عليها المدار: المسجدُ، وعنوانُ
//   الخطبة، وتاريخُها، وخطيبُها — ثم تُوضع الخطبةُ في جمعتها.
//   وجُمَعُ العام تُحسَب من التقويم في المنصة، فلا يُطلب جدولٌ خارجي.
import { h, dialog, toast } from './ui.js';
import { db } from './sb.js';
import { state, MOSQUE, SERMON_TYPES, langByName } from './store.js';
import { readDocxParagraphs } from './docxread.js';
import { setSafeHtml } from './sanitize.js';

// ---------------------------------------------------------------------
// ١) الحرفُ والرقمُ والتاريخ
// ---------------------------------------------------------------------
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
const digits = s => String(s ?? '').replace(/[٠-٩۰-۹]/g, c => AR_DIGITS[c] || c);
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

const H_MONTHS = [
  ['محرم', 'محرّم'],
  ['صفر'],
  ['ربيع الاول', 'ربيع الأول', 'ربيع أول'],
  ['ربيع الثاني', 'ربيع الاخر', 'ربيع الآخر'],
  ['جمادى الاولى', 'جمادى الأولى', 'جمادي الاولى', 'جمادى الأول'],
  ['جمادى الاخرة', 'جمادى الآخرة', 'جمادى الثانية', 'جمادي الثانيه'],
  ['رجب'], ['شعبان'], ['رمضان'], ['شوال', 'شوّال'],
  ['ذو القعدة', 'ذي القعدة', 'ذوالقعدة'],
  ['ذو الحجة', 'ذي الحجة', 'ذوالحجة'],
];
const bare = s => String(s ?? '').replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
const hijriMonth = name => {
  const k = bare(name);
  for (let i = 0; i < H_MONTHS.length; i++) {
    if (H_MONTHS[i].some(a => k.includes(bare(a)))) return i + 1;
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

// هجريٌّ ← ميلاديٌّ بتقويم أم القرى
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

const gFrom = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt) ? null : dt;
};

// سطرٌ ← تاريخُه إن كان فيه. يُقدَّم الميلاديُّ المصرَّحُ به لأنه قاطع
export function findDate(line, defYear) {
  const raw = String(line || '');
  const t = digits(raw);
  let hij = null, greg = null;

  // «الموافق 12/08/2022م» أو «12/08/2022م»
  let m = t.match(/(?:الموافق\s*)?(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*((?:19|20)\d\d)\s*م?/);
  if (m) greg = gFrom(+m[3], +m[2], +m[1]);
  // «2022-8-5»
  if (!greg) {
    m = t.match(/((?:19|20)\d\d)\s*[/\-年]\s*(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
    if (m) greg = gFrom(+m[1], +m[2], +m[3]);
  }
  // «14/01/1444هـ»
  m = t.match(/(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(1[3-5]\d\d)/);
  if (m) hij = [+m[3], +m[2], +m[1]];
  // «1444-1-7» و«伊历1444年1月7日»
  if (!hij) {
    m = t.match(/(1[3-5]\d\d)\s*[/\-年]\s*(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
    if (m) hij = [+m[1], +m[2], +m[3]];
  }
  // «7 محرم 1444هـ» و«4 ربيع الأول 1444»
  if (!hij) {
    m = t.match(/(\d{1,2})\s*(?:من\s+)?([ء-ْ]+(?:\s+[ء-ْ]+)?)\s*(?:سنة\s*)?(1[3-5]\d\d)?\s*(هـ|هجري|ه)?/);
    if (m && (m[3] || m[4])) {
      const mo = hijriMonth(m[2]);
      if (mo) hij = [Number(m[3] || defYear || 0), mo, +m[1]];
    }
  }

  if (!greg && hij && hij[0] >= 1300 && hij[0] <= 1600
      && hij[1] >= 1 && hij[1] <= 12 && hij[2] >= 1 && hij[2] <= 30) {
    greg = hijriToDate(hij[0], hij[1], hij[2]);
  }
  if (!greg) return null;
  return { date: ymd(greg), hijri_text: hij ? `${hij[2]}/${hij[1]}/${hij[0]}هـ` : '' };
}

// ---------------------------------------------------------------------
// ٢) ما يُقرأ من الترويسة
// ---------------------------------------------------------------------
const MOSQUE_RE  = /المسجد\s*(الحرام|النبوي)|الحرم\s*(المكي|المدني)/;
const KHATEEB_RE = /(?:الخطيب|خطيب\s+المسجد)\s*[:：]\s*(.+)$|ل?(?:فضيلة|معالي|سماحة)\s+(?:الشيخ|الدكتور|الأستاذ)\s*[/\\:]?\s*(.+)$/;
const TITLE_RE   = /(?:موضوع\s*الخطبة|عنوان\s*الخطبة|الموضوع|العنوان)\s*[:：]\s*(.+)$/;
const BASMALA_RE = /^بسم\s*الله\s*الرحمن\s*الرحيم\s*$/;
// حيث يبدأ المتنُ تنتهي الترويسةُ: «الخطبة الأولى» وما يجري مجراها
const BODY_RE = /^\(?\s*(الخطبة|الخطبه)\s*(الأولى|الاولى|الثانية|الثانيه)|^أمَّا\s*بعد|^أما\s*بعد|^الحمد\s*لله/;

const TYPE_WORDS = [
  [/عيد\s*الفطر/, 'خطبة عيد الفطر'],
  [/عيد\s*الأضحى|عيد\s*الاضحى/, 'خطبة عيد الأضحى'],
  [/عرفة|عرفات/, 'خطبة عرفة'],
  [/استسقاء/, 'خطبة الاستسقاء'],
  [/كسوف|خسوف/, 'خطبة الكسوف'],
];

const mosqueOf = t => {
  const m = String(t || '').match(MOSQUE_RE);
  if (!m) return '';
  const s = m[0];
  return /الحرام|المكي/.test(s) ? 'makkah' : 'madinah';
};
const typeOf = t => {
  for (const [re, name] of TYPE_WORDS) {
    if (re.test(String(t || '')) && SERMON_TYPES.includes(name)) return name;
  }
  return '';
};
// العنوانُ يُنقّى من الأقواس والنقطتين وما شابهها، عربيةً كانت أو صينية
const cleanTitle = s => String(s || '')
  .replace(/^[\s(){}\[\]«»"'：:،.\u3008-\u3011（）【】]+/, '')
  .replace(/[\s(){}\[\]«»"'：:،\u3008-\u3011（）【】]+$/, '')
  .replace(/\s+/g, ' ').trim();

const cleanName = s => String(s || '')
  // يُقطع الاسمُ عند أوّل رقمٍ أو كلمةٍ من كلمات الترويسة، فلا يَجرُّ ما بعده
  .split(/\s(?=\d)|\s(?=خطبة|الخطبة|الموضوع|العنوان|التاريخ|بالمسجد|المسجد)/)[0]
  .replace(/[-–—(«»"]*\s*(حفظه\s*الله|وفقه\s*الله|رعاه\s*الله|أثابه\s*الله|حفظهم\s*الله)\s*[)»"]*/g, '')
  .replace(/^(فضيلة|معالي|سماحة)\s+/, '')
  .replace(/^(الشيخ|الدكتور|الأستاذ|د\.?|أ\.?)\s*[/\\.]?\s*/g, '')
  .replace(/^(الشيخ|الدكتور|الأستاذ|د\.?|أ\.?)\s*[/\\.]?\s*/g, '')
  .replace(/[()«»"]/g, '').replace(/\s+/g, ' ').replace(/[\s/،.-]+$/, '').trim();

// عدُّ الكلمات: ما لا يُكتب بمسافاتٍ — كالصينية واليابانية — يُعَدُّ بحروفه
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
export function countWords(t) {
  const s = String(t || '').trim();
  if (!s) return 0;
  if (CJK.test(s)) return s.replace(/\s+/g, '').length;
  return s.split(/\s+/).filter(Boolean).length;
}

// العلاماتُ المرشَّحةُ لبدء خطبةٍ جديدة
const ANCHORS = [
  { key: 'tr',  re: /^\s*(ترجمة\s+)?خطب[ةه]\s+(صلاة\s+)?(الجمعة|الجُمعة|العيد|عيد|عرفة|الاستسقاء|الكسوف|الخسوف|المسجد|الحرم)/ },
  { key: 'bsm', re: BASMALA_RE },
  { key: 'date', re: null },     // سطرٌ قصيرٌ ليس فيه إلا تاريخ
];

const isDateOnly = (t, year) => {
  const s = String(t || '').trim();
  if (!s || s.length > 40) return false;
  if (!/\d/.test(digits(s))) return false;
  return !!findDate(s, year) && !/[ء-ي]{6,}/.test(s.replace(/هـ|الموافق|م/g, ''));
};

// ---------------------------------------------------------------------
// ٣) الشقُّ: تُجرَّب العلاماتُ ويُختار أضبطُها
// ---------------------------------------------------------------------
export function splitSermons(paras, { year, fileLang, fileMosque, fridays } = {}) {
  const ps = paras.filter(p => p.text || p.breakBefore);
  const texts = ps.map(p => p.text || '');

  const hitsOf = key => {
    const a = ANCHORS.find(x => x.key === key);
    const out = [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (!t) continue;
      if (key === 'date') { if (isDateOnly(t, year)) out.push(i); }
      else if (a.re.test(t)) out.push(i);
    }
    return out;
  };

  // لكلِّ علامةٍ درجةٌ: كم منها يليه تاريخٌ، وكم تقترب من جُمَع العام
  // تُجرَّب العلاماتُ كلُّها، وتُقدَّم أوفاها بالبيانات الأربعة وأقربُها
  // إلى عدد جُمَع العام
  let best = { key: null, idx: [], score: -1 };
  for (const a of ANCHORS) {
    const idx = hitsOf(a.key);
    if (!idx.length) continue;
    let dated = 0, titled = 0, named = 0, placed = 0;
    for (const i of idx) {
      const hd = readHead(texts, i, year);
      if (hd.date) dated++;
      if (hd.title) titled++;
      if (hd.khateeb) named++;
      if (hd.mosque) placed++;
    }
    const n = idx.length;
    const near = fridays ? 1 - Math.min(1, Math.abs(n - fridays) / Math.max(8, fridays)) : 0.5;
    const score = (dated / n) * 2 + (titled / n) + (named / n) * 0.7 + (placed / n) * 0.7
      + near + Math.min(1, n / 10);
    if (score > best.score) best = { key: a.key, idx, score, dated };
  }
  if (!best.idx.length) return { anchor: null, rows: [] };

  const rows = [];
  for (let n = 0; n < best.idx.length; n++) {
    const from = best.idx[n];
    const to = n + 1 < best.idx.length ? best.idx[n + 1] : ps.length;
    const head = readHead(texts, from, year);
    // المتنُ: ما بعد آخرِ سطرٍ من الترويسة
    const bodyFrom = Math.max(from + 1, head.lastHead + 1);
    const html = ps.slice(bodyFrom, to).map(p => p.html).filter(Boolean).join('\n');
    const words = ps.slice(bodyFrom, to).reduce((a, p) => a + countWords(p.text), 0);
    rows.push({
      mosque: head.mosque || fileMosque || '',
      title: head.title || '',
      khateeb: head.khateeb || '',
      date: head.date || '',
      hijri_text: head.hijri_text || '',
      type: head.type || 'خطبة جمعة',
      lang: fileLang || '',
      head: head.lines,
      html, words,
    });
  }
  return { anchor: best.key, rows, dated: best.dated };
}

// الترويسةُ: ثمانيةُ أسطرٍ بعد العلامة، يُلتقط منها ما عُرف
function readHead(texts, from, year) {
  const out = { lines: [], lastHead: from };
  let seen = 0;
  for (let i = from; i < texts.length && seen < 9; i++) {
    const t = (texts[i] || '').trim();
    if (!t) continue;
    if (i > from && BODY_RE.test(t)) break;      // هنا يبدأ المتن
    seen++;
    let used = false;
    if (!out.mosque && mosqueOf(t)) { out.mosque = mosqueOf(t); used = true; }
    if (!out.type && typeOf(t)) { out.type = typeOf(t); used = true; }
    if (!out.date) {
      const d = findDate(t, year);
      if (d) { out.date = d.date; out.hijri_text = d.hijri_text; used = true; }
    }
    const tm = t.match(TITLE_RE);
    if (tm && !out.title) { out.title = cleanTitle(tm[1]); used = true; }
    const km = t.match(KHATEEB_RE);
    if (km && !out.khateeb) { out.khateeb = cleanName(km[1] || km[2]); used = true; }
    if (BASMALA_RE.test(t)) used = true;
    if (used) { out.lines.push(t); out.lastHead = i; }
    // سطرٌ عربيٌّ قصيرٌ لم يُعرَف: يصلح عنوانًا إن لم يُكتب عنوانٌ بلافتته
    else if (!out.spare && arabicish(t) && t.length >= 4 && t.length <= 120) {
      out.spare = t; out.spareAt = i;
    }
    else if (t.length > 120) break;
  }
  // العنوانُ بلافتته أولى، فإن لم يكن فالسطرُ العربيُّ غيرُ المعروف
  if (!out.title && out.spare) {
    out.title = cleanTitle(out.spare);
    out.lines.push(out.spare);
    out.lastHead = Math.max(out.lastHead, out.spareAt);
  }
  return out;
}

// سطرٌ عربيٌّ في غالبه: يُميَّز به العنوانُ عن متنِ اللغة المترجَم إليها
function arabicish(t) {
  const s = String(t || '').replace(/[\s\d\p{P}]/gu, '');
  if (!s) return false;
  const ar = (s.match(/[\u0621-\u064A]/g) || []).length;
  return ar / s.length >= 0.6;
}

// اللغةُ من اسم الملف: «… (اللغة البنغالية).docx»
export function langOfName(name) {
  const m = String(name || '').match(/\(([^)]*لغة[^)]*)\)/) || String(name || '').match(/\(([^)]+)\)/);
  if (m) { const c = langByName(m[1]); if (c) return c; }
  for (const l of state.languages || []) {
    if (String(name || '').includes(l.name_ar)) return l.code;
  }
  return '';
}
export const mosqueOfName = name => mosqueOf(String(name || ''));

// ---------------------------------------------------------------------
// ٤) نافذةُ الرفع ثم جدولُ المراجعة
// ---------------------------------------------------------------------
export async function importDialog({ sectionId, year, onDone }) {
  const langs = state.languages || [];
  const pick = h('input', { type: 'file', multiple: true, accept: '.docx' });
  const fileLang = h('select', { 'aria-label': 'لغةُ الملفات' },
    h('option', { value: '' }, 'من اسم الملف'),
    ...langs.map(l => h('option', { value: l.code }, l.name_ar)));
  const fileMosque = h('select', { 'aria-label': 'المسجد' },
    h('option', { value: '' }, 'من الترويسة أو اسم الملف'),
    ...Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v)));
  const note = h('p.small.muted', 'لا يُكتب في الأرشيف شيءٌ حتى تعتمد الجدول.');

  // جُمَعُ العام تُحسَب في المنصة، فتُقاس عليها دقّةُ الشقّ والاكتمال
  let gaps = [];
  try { gaps = await db.rpc('arch_year_gaps', { p_year: year }) || []; } catch { gaps = []; }
  const fridays = gaps.length;
  const fridaySet = new Set(gaps.map(g => g.friday_on));

  let rows = [], report = [];
  const parse = async () => {
    rows = []; report = [];
    for (const f of [...pick.files]) {
      note.textContent = `نقرأ ${f.name}…`;
      const paras = await readDocxParagraphs(f);
      const lang = fileLang.value || langOfName(f.name);
      const mos = fileMosque.value || mosqueOfName(f.name);
      const r = splitSermons(paras, { year, fileLang: lang, fileMosque: mos, fridays });
      for (const x of r.rows) rows.push({ ...x, file: f.name });
      report.push({ file: f.name, lang, found: r.rows.length, anchor: r.anchor });
    }
  };

  const res = await dialog({
    title: `رفعُ خطب ${ARY(year)}هـ من ملفات Word`,
    body: h('div.col.gap',
      h('p.small.muted', 'ارفعْ مجمَّعَ العام: ملفًّا لكلِّ لغةٍ أو ملفاتٍ معًا. تُشَقُّ الخطبُ وتُستخرج بياناتُها، ثم تُراجعها قبل الحفظ.'),
      h('label.field', h('span', 'ملفاتُ Word (.docx)'), pick),
      h('div.row.gap.wrap',
        h('label.field', h('span', 'اللغة'), fileLang),
        h('label.field', h('span', 'المسجد'), fileMosque)),
      h('p.small.muted', 'المسجدُ لازمٌ لكلِّ خطبة: كثيرٌ من المجمَّعات لا تذكره في '
        + 'ترويستها، فحدِّدْه هنا ليسريَ على الملفِّ كلِّه — ولك تصحيحُه صفًّا صفًّا بعدُ.'),
      note),
    buttons: [
      { label: 'اقرأ الملفات', kind: 'primary',
        validate: async () => {
          if (!pick.files?.length) return 'اختر ملفًا واحدًا على الأقل';
          try { await parse(); } catch (e) { note.textContent = ''; return e.message; }
          if (!rows.length) return 'لم تُعرَف في الملفات ترويسةُ خطبة — راجع تنسيقَها';
          return true;
        },
        value: () => true },
      { label: 'إلغاء', value: null },
    ],
  });
  if (!res) return;
  await reviewDialog({ sectionId, year, rows, report, fridaySet, fridays, onDone });
}

// ---------------------------------------------------------------------
// ٥) جدولُ المراجعة: ما نقص موسومٌ، وما تمَّ مؤشَّر
// ---------------------------------------------------------------------
async function reviewDialog({ sectionId, year, rows, report, fridaySet, fridays, onDone }) {
  const langs = state.languages || [];
  const fields = [];
  // جمعةُ الأسبوع كما تحسبها قاعدةُ البيانات: اليوم + (٥ − ترتيبِه الأسبوعي)
  const fridayOf = iso => {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00Z');
    const isodow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (5 - isodow));
    return ymd(d);
  };

  const rowEl = (r, i) => {
    const bad = [], warn = [];
    if (!r.title) warn.push('بلا عنوان — يُورَث من خطبةِ الجمعة إن كانت');
    if (!r.date) bad.push('بلا تاريخ');
    else if (fridaySet.size && !fridaySet.has(fridayOf(r.date))) bad.push('خارج العام');
    if (!r.mosque) bad.push('بلا مسجد');
    if (!r.html) bad.push('بلا متن');

    const f = {
      on: h('input', { type: 'checkbox', checked: !bad.length, 'aria-label': `ضمِّ الصفَّ ${i + 1}` }),
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
    const entry = { r, f, i: i + 1, tr: null };
    fields.push(entry);

    const peek = h('button.link.small', { type: 'button' }, 'استعرِض');
    peek.onclick = () => dialog({
      title: f.title.value || 'متنُ الخطبة',
      body: h('div.col.gap',
        h('p.small.muted', (r.head || []).join(' · ')),
        setSafeHtml(h('div.doc-peek', { dir: 'auto' }), r.html || '<p>لا متن</p>')),
      buttons: [{ label: 'إغلاق', value: null }],
    });

    entry.tr = h('tr', { class: bad.length ? 'warn-row' : '' },
      h('td', f.on), h('td.num', String(i + 1)),
      h('td', f.title), h('td', f.mosque), h('td', f.date),
      h('td', f.khateeb), h('td', f.lang), h('td', f.type),
      h('td.num', String(r.words || 0)),
      h('td.small.muted', [...bad, ...warn].join('، ') || '—'),
      h('td', peek));
    return entry.tr;
  };

  const table = h('table.tbl.imp-tbl',
    h('thead', h('tr',
      h('th', '✓'), h('th', '#'), h('th', 'العنوان'), h('th', 'المسجد'),
      h('th', 'التاريخ'), h('th', 'الخطيب'), h('th', 'اللغة'),
      h('th', 'النوع'), h('th', 'كلمات'), h('th', 'ما نقص'), h('th', 'المتن'))),
    h('tbody', ...rows.map(rowEl)));

  const dates = new Set(rows.filter(r => r.date).map(r => fridayOf(r.date)));
  const covered = [...dates].filter(d => fridaySet.has(d)).length;
  const hint = h('div.stack', { style: { gap: '4px' } },
    h('p.small', `قُرئ ${ARY(rows.length)} موضعًا من ${ARY(report.length)} ملفًا، `
      + `طابق منها ${ARY(covered)} من ${ARY(fridays)} جمعةً في العام.`),
    h('p.small.muted', report.map(x => `${x.file}: ${ARY(x.found)}`).join(' · ')),
    h('p.small.muted', 'الصفوفُ المظلَّلةُ ناقصةٌ — أكملْها أو استبعدْها. '
      + 'وما اتّفق تاريخُه ومسجدُه يُضَمُّ في خطبةٍ واحدةٍ تتعدّد لغاتُها.'));

  const all = h('button.btn.sm.ghost', { type: 'button' }, 'أشِّرْ على التامّ وحدَه');
  all.onclick = () => fields.forEach(({ f }) => {
    f.on.checked = !!(f.date.value && f.mosque.value);
  });

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
    body: h('div.col.gap.imp-wrap', hint, h('div.row.gap', all), h('div.scroll-x', table)),
    buttons: [
      { label: 'اعتمدْ واكتبْ في الأرشيف', kind: 'primary',
        validate: async () => {
          const items = collect();
          if (!items.length) return 'لم تَختر صفًّا واحدًا';
          // الصفُّ الناقصُ يُسمَّى ويُقفَز إليه ويُظلَّل، فلا يُبحَث عنه
          fields.forEach(x => x.tr && x.tr.classList.remove('bad-row'));
          // التاريخُ والمسجدُ لازمان: الجمعةُ لا تُعرَف إلا بهما
          for (const [key, what] of [['date', 'تاريخ'], ['mosque', 'مسجد']]) {
            const miss = fields.filter(x => x.f.on.checked && !x.f[key].value);
            if (!miss.length) continue;
            miss.forEach(x => x.tr && x.tr.classList.add('bad-row'));
            const first = miss[0];
            try {
              first.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
              first.f[key].focus();
            } catch { /* يكفي التظليل */ }
            return miss.length === 1
              ? `الصفُّ ${ARY(first.i)} بلا ${what} — أكملْه أو انزعْ علامتَه`
              : `${ARY(miss.length)} صفًّا بلا ${what}: ${miss.slice(0, 8).map(x => ARY(x.i)).join('، ')}`
                + (miss.length > 8 ? ' …' : '');
          }
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

  toast(`كُتبت: ${ARY(out.created || 0)} خطبةً جديدة، وضُمَّ ${ARY(out.merged || 0)}، `
    + `و${ARY(out.versions || 0)} نسخة`, 'ok');
  if (onDone) await onDone();
}

export default importDialog;
