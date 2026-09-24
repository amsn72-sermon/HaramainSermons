// الموقع العام: البث المباشر لخطب الحرمين الشريفين (أحدث خطبة) وأرشيف الخطب والمجالس العلمية.
// المصدر قناة الخطب على يوتيوب، والعرض بمشغّل المنصة لا بمشغّل يوتيوب (ملاحظات ٢١-٢٦، ٣٢-٣٥).
import { h, emptyState, fmtDateTime } from '../ui.js';
import { state, MOSQUE, CITY } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';
import { videoPlayer } from '../player.js';

const cfg = window.HS_CONFIG;
const langCode = t => String(t.code || '').split(':')[0];
const two = (ar, en) => h('span.bi', h('span', ar), h('span.en', en));

// اسم اللغة بالعربية وبلغتها — القائمة مكتوبة باللغتين
const NATIVE = {
  ar: 'العربية', en: 'English', ur: 'اردو', fr: 'Français', fa: 'فارسی', ms: 'Bahasa Melayu',
  id: 'Bahasa Indonesia', ru: 'Русский', tr: 'Türkçe', bn: 'বাংলা', es: 'Español', pt: 'Português',
  ha: 'Hausa', zh: '中文', de: 'Deutsch', sw: 'Kiswahili', hi: 'हिन्दी', ta: 'தமிழ்', ml: 'മലയാളം',
  am: 'አማርኛ', th: 'ไทย', ja: '日本語', ko: '한국어', it: 'Italiano', nl: 'Nederlands', bs: 'Bosanski',
  sq: 'Shqip', az: 'Azərbaycanca', uz: 'Oʻzbekcha', ku: 'Kurdî', ps: 'پښتو', si: 'සිංහල', my: 'ဗမာ',
  vi: 'Tiếng Việt', fil: 'Filipino', so: 'Soomaali', yo: 'Yorùbá', ig: 'Igbo', pl: 'Polski',
  uk: 'Українська', ro: 'Română', el: 'Ελληνικά', he: 'עברית', hu: 'Magyar', cs: 'Čeština'
};
const nameAr = t => state.languages.find(l => l.code === langCode(t))?.name_ar || (langCode(t) === 'ar' ? 'العربية' : t.language);
const nativeOf = t => NATIVE[langCode(t)] || (langCode(t) === 'ar' ? 'العربية' : (t.englishName || '').replace(/^Original\s+/i, ''));
const bilingual = t => { const a = nameAr(t), n = nativeOf(t); return n && n !== a ? `${a} — ${n}` : a; };

// ------- تصنيف الخطبة إلى الحرمين اعتمادًا على تسمية القناة على يوتيوب -------
const MAK = ['الحرام', 'مكة', 'عرفة', 'نمرة', 'مسجد حرام', 'Sacrée', 'Sacred', 'Grand Mosque', 'Makkah', 'Mecca', 'Haram', '圣寺', 'হারাম', 'মক্কা'];
const MAD = ['النبوي', 'المدينة', 'نبوی', 'نبوي', 'Prophétique', 'Prophet', 'Nabawi', '先知寺', 'Madinah', 'Medina', 'নববী', 'মদিনা'];
export function venueOf(r) {
  if (r.venue === 'makkah' || r.venue === 'madinah') return r.venue;
  const t = `${r.title || ''} ${r.groupTitle || ''} ${r.originalTitle || ''}`;
  if (MAD.some(k => t.includes(k))) return 'madinah';
  if (MAK.some(k => t.includes(k))) return 'makkah';
  return 'other';
}

// خطبة جمعة أو عيد أو استسقاء… لا درس ولا مجلس علمي (ملاحظة ٣٥)
const LESSON = /مجالس|مجلس|درس|دروس|برنامج|محاضرة|شرح/;
export function isSermon(r) {
  const t = `${r.title || ''} ${r.groupTitle || ''}`;
  if (LESSON.test(t)) return false;
  if (['friday', 'eid', 'arafah'].includes(r.kind)) return true;
  return /خطبة|خطب|Sermon|Khutbah|خطبۂ|جمعہ|主麻|খুতবা/.test(t);
}

const titleRank = r => (r.translations || []).length + (/المسجد|خطبة/.test(r.title || '') ? 100 : 0);

// خطبة واحدة لكل تاريخ في كل مسجد، تجتمع فيها كل اللغات من قوائم القناة
export function groupRecords(list) {
  const groups = new Map(); const out = [];
  for (const r of list || []) {
    const venue = venueOf(r);
    const translations = (r.translations || []).filter(t => t.videoId);
    if (!translations.length) continue;
    const day = r.sourceTime || r.dateLabel;
    const kind = r.kind === 'other' ? 'friday' : (r.kind || 'friday');
    const key = venue === 'other' || !day ? null : `${venue}|${kind}|${day}`;
    const g = key && groups.get(key);
    if (!g) {
      const rec = { ...r, venue, translations, day, sermon: isSermon(r), rank: titleRank({ translations, title: r.title }) };
      if (key) groups.set(key, rec);
      out.push(rec);
      continue;
    }
    const seen = new Set(g.translations.map(langCode));
    for (const t of translations) if (!seen.has(langCode(t))) { g.translations.push(t); seen.add(langCode(t)); }
    const rank = titleRank({ translations, title: r.title });
    if (rank > g.rank) { g.title = r.title; g.dateLabel = r.dateLabel || g.dateLabel; g.rank = rank; g.sermon = g.sermon || isSermon(r); }
  }
  return out;
}

// أسابيع: لكل تاريخ صفٌّ فيه خطبة مكة (يمينًا) وخطبة المدينة (يسارًا) — ملاحظة ٣٣
// مفتاح ترتيب رقمي من التاريخ الهجري (1448-04-07 → 14480407)، وما لا تاريخ له يُؤخَّر
export function dayKey(v) {
  const m = String(v || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  const y = String(v || '').match(/(\d{4})/);
  return y ? Number(y[1]) * 10000 : 0;
}

export function toWeeks(records) {
  const byDay = new Map();
  for (const r of records) {
    const day = r.day || r.dateLabel || r.id;
    if (!byDay.has(day)) byDay.set(day, { day, key: dayKey(r.day || r.dateLabel), dateLabel: r.dateLabel || 'خطبة بلا تاريخ محدد', makkah: null, madinah: null, other: [] });
    const w = byDay.get(day);
    if (r.venue === 'makkah' && !w.makkah) w.makkah = r;
    else if (r.venue === 'madinah' && !w.madinah) w.madinah = r;
    else w.other.push(r);
  }
  return [...byDay.values()].sort((a, b) => b.key - a.key || String(b.day).localeCompare(String(a.day)));
}

export async function render(ctx) {
  const feed = await fetch(cfg.feedUrl, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const all = groupRecords([...(feed?.current || []), ...(feed?.archive || [])]);
  const sermons = all.filter(r => r.sermon && r.venue !== 'other');
  const lessons = all.filter(r => !r.sermon);
  const weeks = toWeeks(sermons);
  const lessonWeeks = toWeeks(lessons);
  // أحدث الخطب: من خطب الجمعة المحدَّدة التاريخ فقط، لا درسٍ ولا مجلس (ملاحظة ٣٥)
  const fridays = weeks.filter(w => w.key > 0 && (w.makkah?.kind === 'friday' || w.madinah?.kind === 'friday'));
  const latestWeek = fridays[0] || weeks[0];

  const tabs = [['latest', 'البث المباشر لخطب الحرمين الشريفين', 'Latest Friday sermons'],
    ['archive', 'أرشيف الخطب والمجالس', 'Sermons & lessons archive']];
  let active = ctx.query.get('tab') || 'latest';
  const panel = h('div');
  const tabBar = h('div.tabs', { role: 'tablist' });

  // بطاقة خطبة: قائمة لغات منسدلة باللغتين + مشغّل المنصة
  function sermonCard(rec) {
    const list = rec.translations || [];
    const sel = h('select.lang-select', { 'aria-label': 'لغة الخطبة — Sermon language' },
      list.map((t, i) => h('option', { value: String(i) }, bilingual(t))));
    const box = h('div.vp-slot');
    const show = () => {
      const t = list[Number(sel.value) || 0];
      box.replaceChildren(t ? videoPlayer({ videoId: t.videoId, title: `${rec.title} — ${nameAr(t)}`, subtitle: `${bilingual(t)}` })
        : h('div.empty', 'لا يوجد تسجيل — No recording'));
    };
    sel.addEventListener('change', show); show();
    const v = rec.venue;
    return h('article.card.sermon-card',
      v !== 'other' && h('div.eyebrow', `${MOSQUE[v]} — ${CITY[v]}`),
      h('h3', rec.title),
      h('p.small.muted', rec.dateLabel || ''),
      h('label.field.lang-pick', two(`لغة الخطبة (${list.length})`, 'Language'), sel),
      box);
  }

  const weekRow = w => h('section.week',
    h('div.week-head', h('h3', w.dateLabel || w.day), h('span.small.muted', `${[w.makkah, w.madinah].filter(Boolean).length} خطبة`)),
    h('div.grid-2',
      w.makkah ? sermonCard(w.makkah) : h('div.card.empty-slot', two('لا توجد خطبة من المسجد الحرام', 'No Makkah sermon')),
      w.madinah ? sermonCard(w.madinah) : h('div.card.empty-slot', two('لا توجد خطبة من المسجد النبوي', 'No Madinah sermon')),
      ...w.other.map(sermonCard)));

  const views = {
    latest: () => {
      if (!weeks.length) return emptyState('تعذّر تحميل أحدث الخطب', 'حاول مجددًا بعد قليل.');
      return h('div.stack',
        h('p.small.muted', 'آخر تحديث: ' + fmtDateTime(feed?.lastSuccessfulSync)),
        weekRow({ ...latestWeek, other: [] }));
    },

    archive: () => {
      if (!weeks.length && !lessonWeeks.length) return emptyState('الأرشيف غير متاح الآن', 'حاول مجددًا بعد قليل.');
      const q = h('input', { type: 'search', placeholder: 'ابحث بعنوان الخطبة أو التاريخ — Search', 'aria-label': 'البحث في الأرشيف' });
      const secBox = h('div.stack'); const lessonBox = h('div.stack');
      const more = h('button.btn.sm', { type: 'button' }, two('عرض المزيد', 'Show more'));
      const moreLessons = h('button.btn.sm', { type: 'button' }, two('عرض المزيد', 'Show more'));
      let shown = 3, shownL = 2;

      const match = (w, s) => !s || (w.dateLabel || '').includes(s) ||
        [w.makkah, w.madinah, ...w.other].some(r => r && (r.title || '').includes(s));
      const draw = () => {
        const s = q.value.trim();
        const ws = weeks.filter(w => match(w, s));
        const ls = lessonWeeks.filter(w => match(w, s));
        secBox.replaceChildren(...(ws.length ? ws.slice(0, shown).map(weekRow) : [emptyState('لا نتائج مطابقة', '')]));
        lessonBox.replaceChildren(...(ls.length ? ls.slice(0, shownL).map(weekRow) : [h('p.muted', 'لا مجالس مطابقة')]));
        more.hidden = ws.length <= shown; moreLessons.hidden = ls.length <= shownL;
      };
      more.addEventListener('click', () => { shown += 3; draw(); });
      moreLessons.addEventListener('click', () => { shownL += 2; draw(); });
      q.addEventListener('input', () => { shown = 3; shownL = 2; draw(); });
      draw();

      return h('div.stack',
        h('div.grid', h('label.field', two('البحث', 'Search'), q)),
        h('div.section-head.sm', h('h3', 'خطب الجمعة — Friday sermons'), h('p', 'المسجد الحرام يمينًا والمسجد النبوي يسارًا، أسبوعًا بعد أسبوع')),
        secBox, h('div.row', more),
        h('div.section-head.sm', { style: { marginTop: '28px' } }, h('h3', 'المجالس العلمية والدروس — Lessons'), h('p', 'من قناة الخطب على يوتيوب')),
        lessonBox, h('div.row', moreLessons));
    }
  };

  function select(key) {
    active = key;
    tabBar.replaceChildren(...tabs.map(([k, ar, en]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === active), onclick: () => select(k) }, two(ar, en))));
    history.replaceState(null, '', key === 'latest' ? '/' : `/?tab=${key}`);
    const [title, sub] = HEADS[key];
    panel.replaceChildren(h('div.section-head', h('h2', title), h('p', sub)), views[key]());
  }
  select(tabs.some(([k]) => k === active) ? active : 'latest');

  return h('div',
    h('header.topbar', h('div.inner',
      brand('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'ترجمات بلغات العالم', '/'),
      h('div.spacer'), themeToggle(), h('a.btn.sm', { href: '/start' }, 'دخول فريق الترجمة'))),
    h('main#main.wrap.public', { tabindex: '-1' },
      h('section.hero',
        h('div.eyebrow', 'المسجد الحرام والمسجد النبوي'),
        h('h1', 'استمع إلى خطبة الجمعة من الحرمين الشريفين بلغتك'),
        h('p', 'Friday sermons from the Two Holy Mosques in the languages of the world — أحدث الخطب وأرشيفها والمجالس العلمية.')),
      tabBar,
      panel),
    footer('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'));
}

const HEADS = {
  latest: ['البث المباشر لخطب الحرمين الشريفين', 'أحدث خطبة جمعة من المسجد الحرام والمسجد النبوي — اختر اللغة من القائمة'],
  archive: ['أرشيف الخطب والمجالس', 'خطب الجمعة السابقة والمجالس العلمية من قناة الخطب']
};
