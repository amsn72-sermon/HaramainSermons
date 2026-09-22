// الموقع العام: البث المباشر، أحدث الخطب، الأرشيف، والترجمات المكتوبة المعتمدة
import { h, emptyState, fmtDateTime, fmtSermonDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, MOSQUE, CITY } from '../store.js';
import { setSafeHtml } from '../sanitize.js';
import { brand, themeToggle, footer } from './shell.js';

const cfg = window.HS_CONFIG;
const langCode = t => String(t.code || '').split(':')[0];
// اسم اللغة من المرجع الموحّد، لا من عنوان يوتيوب
const nameOf = t => state.languages.find(l => l.code === langCode(t))?.name_ar || (langCode(t) === 'ar' ? 'العربية' : t.language);
const embed = id => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`;
const venueOf = r => r.venue === 'madinah' ? 'madinah' : 'makkah';

export async function render(ctx) {
  const [feed, written] = await Promise.all([
    fetch(cfg.feedUrl, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
    db.rpc('public_translations', { p_mosque: null, p_limit: 200 }).catch(() => [])
  ]);
  const writtenFor = rec => written.filter(w => w.feed_record_id && w.feed_record_id === rec.id);

  const tabs = [['live', 'البث المباشر'], ['latest', 'أحدث الخطب'], ['archive', 'الأرشيف'], ['written', 'الترجمات المكتوبة']];
  let active = ctx.query.get('tab') || 'live';
  const panel = h('div');
  const tabBar = h('div.tabs', { role: 'tablist' });

  function sermonCard(rec) {
    const list = (rec.translations || []).filter(t => t.videoId);
    let chosen = list[0];
    const video = h('div.video');
    const pills = h('div.lang-pills', { role: 'group', 'aria-label': 'لغة الخطبة' });
    const extra = h('div');
    function show() {
      video.replaceChildren(chosen ? h('iframe', { src: embed(chosen.videoId), title: `${rec.title} — ${nameOf(chosen)}`, loading: 'lazy',
        allow: 'encrypted-media; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin' }) : h('div.empty', 'لا يوجد تسجيل'));
      pills.replaceChildren(...list.map(t => h('button', { type: 'button', 'aria-pressed': String(t === chosen), onclick: () => { chosen = t; show(); } }, nameOf(t))));
      const w = chosen && writtenFor(rec).find(x => x.language_code === langCode(chosen));
      extra.replaceChildren(w ? writtenBlock(w, false) : '');
    }
    show();
    return h('article.card',
      h('div.eyebrow', `${MOSQUE[venueOf(rec)]} — ${CITY[venueOf(rec)]}`),
      h('h3', rec.title),
      h('p.small.muted', rec.dateLabel || ''),
      pills, video, extra);
  }

  function writtenBlock(w, withTitle = true) {
    return h('div.stack', { style: { marginTop: '12px', gap: '8px' } },
      withTitle && h('div', h('b', w.title), h('div.small.muted', [MOSQUE[w.mosque], w.khateeb, w.sermon_date && fmtSermonDate(w.sermon_date), w.language_name].filter(Boolean).join(' · '))),
      h('details', { open: withTitle ? null : true }, h('summary', `النص المترجم — ${w.language_name}`),
        setSafeHtml(h('div.translation-text', { dir: w.dir, lang: w.language_code }), w.translation_html)),
      w.audio_path && h('audio', { controls: true, preload: 'none', src: storage.publicUrl('audio', w.audio_path), style: { width: '100%' } }));
  }

  const views = {
    live: () => h('div.grid-2', cfg.liveChannels.map(c => h('article.card',
      h('div.eyebrow', h('span.live-dot', { 'aria-hidden': 'true' }), 'مباشر'), h('h3', c.name), h('p.small.muted', c.place),
      h('div.video', h('iframe', { src: c.embed, title: `${c.name} — بث مباشر`, loading: 'lazy', allow: 'encrypted-media; picture-in-picture; fullscreen' }))))),

    latest: () => {
      if (!feed?.current?.length) return emptyState('تعذّر تحميل أحدث الخطب', 'حاول مجددًا بعد قليل.');
      const byVenue = ['makkah', 'madinah'].map(v => feed.current.find(r => venueOf(r) === v)).filter(Boolean);
      return h('div.stack',
        h('p.small.muted', 'آخر تحديث: ' + fmtDateTime(feed.lastSuccessfulSync)),
        h('div.grid-2', byVenue.map(sermonCard)));
    },

    archive: () => {
      const all = (feed?.archive || []).filter(r => (r.translations || []).some(t => t.videoId));
      if (!all.length) return emptyState('الأرشيف غير متاح الآن', 'حاول مجددًا بعد قليل.');
      const q = h('input', { type: 'search', placeholder: 'ابحث بعنوان الخطبة أو التاريخ', 'aria-label': 'البحث في الأرشيف' });
      const venue = h('select', { 'aria-label': 'الموقع' }, h('option', { value: '' }, 'الحرمان'), Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v)));
      const list = h('div.stack'); const more = h('button.btn', { type: 'button' }, 'عرض المزيد');
      let shown = 12;
      const draw = () => {
        const s = q.value.trim();
        const items = all.filter(r => (!venue.value || venueOf(r) === venue.value) && (!s || r.title.includes(s) || (r.dateLabel || '').includes(s)));
        list.replaceChildren(...items.slice(0, shown).map(r => h('details.card',
          h('summary', h('b', r.title), h('span.small.muted', ' · ' + (r.dateLabel || ''))),
          h('div', { style: { marginTop: '12px' } }, sermonCard(r)))));
        more.hidden = items.length <= shown;
        if (!items.length) list.replaceChildren(emptyState('لا نتائج', 'جرّب كلمة أخرى.'));
      };
      q.addEventListener('input', () => { shown = 12; draw(); }); venue.addEventListener('change', () => { shown = 12; draw(); });
      more.addEventListener('click', () => { shown += 12; draw(); });
      draw();
      return h('div.stack', h('div.grid', h('label.field', 'البحث', q), h('label.field', 'الموقع', venue)), list, h('div.row', more));
    },

    written: () => {
      if (!written.length) return emptyState('لا توجد ترجمات مكتوبة منشورة بعد', 'تظهر هنا فور اعتمادها من مدير المشروع.');
      const langs = [...new Map(written.map(w => [w.language_code, w.language_name])).entries()];
      const sel = h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'), langs.map(([c, n]) => h('option', { value: c }, n)));
      const list = h('div.stack');
      const draw = () => list.replaceChildren(...written.filter(w => !sel.value || w.language_code === sel.value).map(w => h('article.card', writtenBlock(w))));
      sel.addEventListener('change', draw); draw();
      return h('div.stack', h('div.grid', h('label.field', 'اللغة', sel)), list);
    }
  };

  function select(key) {
    active = key;
    tabBar.replaceChildren(...tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === active), onclick: () => select(k) }, label)));
    history.replaceState(null, '', key === 'live' ? '/' : `/?tab=${key}`);
    const [title, sub] = HEADS[key];
    panel.replaceChildren(h('div.section-head', h('h2', title), h('p', sub)), views[key]());
  }
  select(tabs.some(([k]) => k === active) ? active : 'live');

  return h('div',
    h('header.topbar', h('div.inner',
      brand('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'ترجمات بلغات العالم', '/'),
      h('div.spacer'), themeToggle(), h('a.btn.sm', { href: '/start' }, 'دخول فريق الترجمة'))),
    h('main#main.wrap.public', { tabindex: '-1' },
      h('section.hero',
        h('div.eyebrow', 'المسجد الحرام والمسجد النبوي'),
        h('h1', 'استمع إلى خطبة الجمعة من الحرمين الشريفين بلغتك'),
        h('p', 'البث المباشر للقناتين، وأحدث خطب مكة المكرمة والمدينة المنورة، مع أرشيف الخطب السابقة والترجمات المكتوبة المعتمدة.')),
      tabBar,
      panel),
    footer('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'));
}

const HEADS = {
  live: ['البث المباشر', 'القناتان الرسميتان على يوتيوب'],
  latest: ['أحدث الخطب', 'آخر خطبة جمعة من المسجد الحرام والمسجد النبوي بلغات العالم'],
  archive: ['الأرشيف', 'خطب الجمعة السابقة من الحرمين الشريفين'],
  written: ['الترجمات المكتوبة', 'نصوص الخطب المترجمة المعتمدة من مدير المشروع']
};
