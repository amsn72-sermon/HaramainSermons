// أيقوناتٌ مرسومةٌ هنا بلا مكتبةٍ خارجية — فسياسةُ المحتوى تمنع ما جاء من
// خارج الموقع. كلُّها مربّعٌ ٢٤، بخطٍّ من لون النصِّ الجاري (ملاحظة ٢٣١).
import { h } from './ui.js';

const P = {
  doc:       'M6 2h7l5 5v15H6zM13 2v5h5',
  book:      'M4 4a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2zM6 18h12',
  archive:   'M3 4h18v4H3zM5 8v12h14V8M9 12h6',
  globe:     'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20',
  check:     'M4 12.5 9.5 18 20 6',
  shield:    'M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5zM8.5 12l2.5 2.5L16 9.5',
  clock:     'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6v6l4 2',
  users:     'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 21a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M16 15a6 6 0 0 1 6 6',
  star:      'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  map:       'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6zM9 3v15M15 6v15',
  mic:       'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  chart:     'M4 20V4M4 20h16M8 20v-6M12 20v-10M16 20v-4',
  lock:      'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4M12 15v2',
  badge:     'M12 2l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V5zM9.5 11.5 12 14l3-4',
  clipboard: 'M8 4H6v17h12V4h-2M9 2h6v4H9zM9 11h6M9 15h4',
  calendar:  'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  video:     'M3 6h12v12H3zM15 10l6-3v10l-6-3z',
  door:      'M6 3h9v18H6zM12 12h.01M15 21h3V3h-3',
  refresh:   'M20 11A8 8 0 0 0 6 6.5M4 13a8 8 0 0 0 14 4.5M4 5v5h5M20 19v-5h-5',
  steps:     'M4 20h5v-5H4zM9 15h5v-5H9zM14 10h6V5h-6',
  pen:       'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4',
  bolt:      'M13 2 4 14h7l-1 8 9-12h-7z',
  layers:    'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  folder:    'M3 6h6l2 3h10v11H3z',
  search:    'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l5 5',
  announce:  'M4 10v4h4l6 4V6l-6 4zM18 9a4 4 0 0 1 0 6',
  leaflet:   'M4 4h7v16H4zM11 4h9v16h-9M15 8h3M15 12h3',
  post:      'M4 4h16v16H4zM7 8h10M7 12h10M7 16h6',
  compass:   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M15.5 8.5l-2 5-5 2 2-5z',
  qr:        'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  link:      'M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-6-6l-1 1M14 11a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 6 6l1-1',
  tag:       'M3 12V4h8l9 9-8 8zM7.5 7.5h.01',
  // أيقوناتُ صفوف الأعضاء والحسابات (ملاحظتا ٤٠٣ و٤٠٤)
  gauge:     'M12 20a8 8 0 1 1 8-8M12 20a8 8 0 0 0 8-8M12 12l4.5-3.5',
  power:     'M12 3v8M7.5 6.3a7.5 7.5 0 1 0 9 0',
  trash:     'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  letter:    'M3 6h18v12H3zM3 7l9 6 9-6',
  idcard:    'M3 6h18v12H3zM8 11.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6M5 16a3.5 3.5 0 0 1 6 0M14 10h5M14 13h4',
  fixnum:    'M4 17 14 7l3 3L7 20H4zM14.5 6.5 17.5 9.5M16 3h5M18.5 3v5',
  back:      'M20 11A8 8 0 0 0 6 6.5M4 5v5h5M4 13a8 8 0 0 0 14 4.5',
  verify:    'M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5zM8.5 12l2.5 2.5L16 9.5'
};

export function icon(name, { size = 22, title = '' } = {}) {
  const d = P[name] || P.doc;
  const el = h('span.ico', { 'aria-hidden': title ? null : 'true', title: title || null });
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="${d}"/></svg>`;
  return el;
}

// أيقونةُ نوع المادة في المستودع (ملاحظة ٢٢٦)
const TYPE_ICON = {
  'خطب': 'mic', 'دروس علمية': 'book', 'توجيهات': 'compass', 'كتب': 'book',
  'مطويات': 'leaflet', 'منشورات': 'post', 'إعلانات': 'announce'
};
export const typeIcon = (t, opts) => icon(TYPE_ICON[t] || 'doc', opts);

// أيقونةُ قسمٍ في صفحتي «عن» — لكل قسمٍ رمزُه (ملاحظة ٢٣١)
const SECTION_ICON = {
  initiative: 'star', vision: 'compass', goals: 'check', scope: 'globe',
  how: 'steps', platform: 'layers', quality: 'shield', docs: 'qr',
  archive: 'archive', interpretation: 'mic', glossary: 'book', team: 'users',
  rooms: 'video', training: 'badge', field: 'map', security: 'lock',
  continuity: 'refresh', governance: 'clipboard', outputs: 'folder',
  services: 'tag', future: 'bolt', closing: 'check', brief: 'doc',
  pages: 'post', contact: 'link'
};
export const sectionIcon = (id, opts) => icon(SECTION_ICON[id] || 'doc', opts);
