// الموقع العام: البث المباشر لخطب الحرمين الشريفين (أحدث الخطب) وأرشيف الخطب — مصدرها قناة الخطب على يوتيوب.
import { h, emptyState, fmtDateTime } from '../ui.js';
import { state, MOSQUE, CITY } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';

const cfg = window.HS_CONFIG;
const langCode = t => String(t.code || '').split(':')[0];
// المشاهدة فقط: لا أزرار تحكم ولا تقديم ولا تأخير أسفل الفيديو (ملاحظة ٢٦)
const embed = id => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` +
  '?rel=0&controls=0&disablekb=1&modestbranding=1&iv_load_policy=3&playsinline=1';

// اسم اللغة بالعربية من المرجع الموحّد، واسمها بلغتها لتظهر القائمة باللغتين
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
// «الإنجليزية — English»
const bilingual = t => {
  const a = nameAr(t), n = nativeOf(t);
  return n && n !== a ? `${a} — ${n}` : a;
};

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
const GROUPS = [
  ['makkah', `خطب ${MOSQUE.makkah}`, CITY.makkah],
  ['madinah', `خطب ${MOSQUE.madinah}`, CITY.madinah],
  ['other', 'خطب وبرامج أخرى', 'من قناة الخطب']
];

// خطبة واحدة لكل تاريخ في كل مسجد، تجتمع فيها كل اللغات من قوائم القناة
const titleRank = r => (r.translations || []).length + (/المسجد|خطبة/.test(r.title || '') ? 100 : 0);
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
      const rec = { ...r, venue, translations, rank: titleRank({ translations, title: r.title }) };
      if (key) groups.set(key, rec);
      out.push(rec);
      continue;
    }
    const seen = new Set(g.translations.map(langCode));
    for (const t of translations) if (!seen.has(langCode(t))) { g.translations.push(t); seen.add(langCode(t)); }
    // العنوان الأوضح هو عنوان القائمة الجامعة على يوتيوب (الأكثر لغاتٍ وبالعربية)
    const rank = titleRank({ translations, title: r.title });
    if (rank > g.rank) { g.title = r.title; g.dateLabel = r.dateLabel || g.dateLabel; g.rank = rank; }
  }
  return out;
}

export async function render(ctx) {
  const feed = await fetch(cfg.feedUrl, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const latest = groupRecords(feed?.current);
  const archive = groupRecords(feed?.archive);

  const tabs = [['latest', 'البث المباشر لخطب الحرمين الشريفين'], ['archive', 'أرشيف الخطب']];
  let active = ctx.query.get('tab') || 'latest';
  const panel = h('div');
  const tabBar = h('div.tabs', { role: 'tablist' });

  // بطاقة خطبة: قائمة منسدلة باللغتين، والمشغّل تحتها
  function sermonCard(rec) {
    const list = rec.translations || [];
    const sel = h('select.lang-select', { 'aria-label': 'لغة الخطبة' },
      list.map((t, i) => h('option', { value: String(i) }, bilingual(t))));
    const video = h('div.video');
    const show = () => {
      const t = list[Number(sel.value) || 0];
      video.replaceChildren(t ? h('iframe', { src: embed(t.videoId), title: `${rec.title} — ${nameAr(t)}`, loading: 'lazy',
        allow: 'encrypted-media; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin' })
        : h('div.empty', 'لا يوجد تسجيل'));
    };
    sel.addEventListener('change', show); show();
    const v = rec.venue;
    return h('article.card',
      v !== 'other' && h('div.eyebrow', `${MOSQUE[v]} — ${CITY[v]}`),
      h('h3', rec.title),
      h('p.small.muted', rec.dateLabel || ''),
      h('label.field.lang-pick', `اختر اللغة (${list.length})`, sel),
      video);
  }

  const views = {
    latest: () => {
      if (!latest.length) return emptyState('تعذّر تحميل أحدث الخطب', 'حاول مجددًا بعد قليل.');
      const byVenue = ['makkah', 'madinah'].map(v => latest.find(r => r.venue === v)).filter(Boolean);
      return h('div.stack',
        h('p.small.muted', 'آخر تحديث: ' + fmtDateTime(feed.lastSuccessfulSync)),
        h('div.grid-2', (byVenue.length ? byVenue : latest.slice(0, 2)).map(sermonCard)));
    },

    archive: () => {
      if (!archive.length) return emptyState('الأرشيف غير متاح الآن', 'حاول مجددًا بعد قليل.');
      const q = h('input', { type: 'search', placeholder: 'ابحث بعنوان الخطبة أو التاريخ', 'aria-label': 'البحث في الأرشيف' });
      const wrap = h('div.stack');
      const sections = GROUPS.map(([key, label, place]) => {
        const items = archive.filter(r => r.venue === key);
        const list = h('div.stack.arch-list');
        const more = h('button.btn.sm', { type: 'button' }, 'عرض المزيد');
        const count = h('span.small.muted');
        const sec = h('section.arch-group', { hidden: !items.length },
          h('div.section-head.sm', h('h3', label), h('p', place)), count, list, h('div.row', more));
        return { key, items, list, more, count, sec, shown: 8 };
      });
      const draw = () => {
        const s = q.value.trim();
        for (const g of sections) {
          const found = g.items.filter(r => !s || (r.title || '').includes(s) || (r.dateLabel || '').includes(s));
          g.list.replaceChildren(...found.slice(0, g.shown).map(r => h('details.card',
            h('summary', h('b', r.title), h('span.small.muted', ' · ' + (r.dateLabel || ''))),
            h('div', { style: { marginTop: '12px' } }, sermonCard(r)))));
          g.count.textContent = found.length ? `${found.length} خطبة` : 'لا نتائج مطابقة';
          g.more.hidden = found.length <= g.shown;
          g.sec.hidden = !g.items.length;
        }
      };
      sections.forEach(g => g.more.addEventListener('click', () => { g.shown += 8; draw(); }));
      q.addEventListener('input', () => { sections.forEach(g => { g.shown = 8; }); draw(); });
      draw();
      wrap.replaceChildren(h('div.grid', h('label.field', 'البحث', q)), ...sections.map(g => g.sec));
      return wrap;
    }
  };

  function select(key) {
    active = key;
    tabBar.replaceChildren(...tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === active), onclick: () => select(k) }, label)));
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
        h('p', 'أحدث خطب المسجد الحرام والمسجد النبوي بلغات العالم، مع أرشيف الخطب السابقة.')),
      tabBar,
      panel),
    footer('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'));
}

const HEADS = {
  latest: ['البث المباشر لخطب الحرمين الشريفين', 'أحدث خطبة من المسجد الحرام والمسجد النبوي — اختر اللغة من القائمة'],
  archive: ['أرشيف الخطب', 'خطب المسجد الحرام والمسجد النبوي السابقة، كلٌّ في موضعه']
};
