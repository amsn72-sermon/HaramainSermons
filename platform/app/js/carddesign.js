// نموذج تصميم بطاقة العمل: مقاسات بالمليمتر وخطوط بالنقطة (ملاحظة ٨٦)
// يشترك فيه المصمِّم على الشاشة وصفحة الطباعة، فما تراه هو ما يُطبع.

export const CARD = { w: 85.6, h: 54 };        // مقاس ISO/IEC 7810 ID-1
export const MM_PT = 25.4 / 72;                 // مليمترات النقطة الواحدة
export const HARAMAIN_LOGO = '/assets/alharamain-logo.png';

export const ITEM_LABEL = {
  logo: 'الشعار',
  title: 'عنوان البطاقة',
  subtitle: 'السطر تحته',
  photo: 'الصورة الشخصية',
  name: 'الاسم',
  role: 'الصفة',
  langs: 'اللغات',
  member_no: 'رقم العضوية',
  official: 'المسؤول والتوقيع',
  valid: 'الصلاحية'
};
export const ITEM_ORDER = ['logo', 'title', 'subtitle', 'photo', 'name', 'role', 'langs', 'member_no', 'official', 'valid'];
export const TEXT_ITEMS = ITEM_ORDER.filter(k => k !== 'logo' && k !== 'photo');

export const COLORS = [
  ['#ffffff', 'أبيض'], ['#1c1a17', 'أسود'], ['#1a232d', 'كحلي'],
  ['#8a6f3c', 'ذهبي داكن'], ['#bc9661', 'ذهبي'], ['#d5bd87', 'ذهبي فاتح'],
  ['#55503f', 'رمادي داكن'], ['#6b6257', 'رمادي'], ['#2f6b52', 'أخضر']
];

// ثلاثة قوالب جاهزة: يختار المدير أقربها إلى ما يريد ثم يعدّل عليه
export const PRESETS = [
  ['classic', 'رسمي داكن — شريط علوي'],
  ['sidebar', 'شريط جانبي — الصورة والشعار معًا'],
  ['light',   'فاتح بإطار ذهبي']
];

export const PRESET_LAYOUT = {
  // ١) شريط داكن أعلى البطاقة، والصورة إلى اليمين
  classic: () => ({
    v: 1, custom: [],
    card: { bg: '#ffffff', border: '#d8cfbd' },
    band: { show: true, side: 'top', h: 12.5, bg: '#1a232d', line: '#bc9661', lineH: 0.8 },
    rules: {
      top:    { show: false, x: 4, y: 13.6, w: 77.6, h: 0.3, color: '#bc9661' },
      bottom: { show: true,  x: 4, y: 39.6, w: 77.6, h: 0.3, color: '#e2d9c8' }
    },
    items: {
      logo:      { x: 69.5, y: 2.4,  w: 13,   show: true },
      title:     { x: 4,    y: 3.2,  w: 64,   size: 8.4, bold: true,  align: 'right', color: '#ffffff', show: true },
      subtitle:  { x: 4,    y: 7.8,  w: 64,   size: 5.8, bold: false, align: 'right', color: '#d5bd87', show: true },
      photo:     { x: 68,   y: 16,   w: 14,   show: true },
      name:      { x: 6,    y: 17.4, w: 58,   size: 9.6, bold: true,  align: 'right', color: '#1c1a17', show: true },
      role:      { x: 6,    y: 23.8, w: 58,   size: 7,   bold: true,  align: 'right', color: '#8a6f3c', show: true },
      langs:     { x: 6,    y: 28.4, w: 58,   size: 6.4, bold: false, align: 'right', color: '#55503f', show: true },
      member_no: { x: 6,    y: 32.8, w: 58,   size: 6.6, bold: false, align: 'right', color: '#6b6257', show: true },
      official:  { x: 44,   y: 41.4, w: 38,   size: 6.6, bold: true,  align: 'right', color: '#55503f', show: true },
      valid:     { x: 5,    y: 47,   w: 36,   size: 6.2, bold: false, align: 'left',  color: '#55503f', show: true }
    }
  }),
  // ٢) شريط رأسي على يمين البطاقة يجمع الشعار والصورة
  sidebar: () => ({
    v: 1, custom: [],
    card: { bg: '#ffffff', border: '#d8cfbd' },
    band: { show: true, side: 'right', h: 26, bg: '#1a232d', line: '#bc9661', lineH: 0.8 },
    rules: {
      top:    { show: true,  x: 4, y: 13,   w: 54, h: 0.3, color: '#bc9661' },
      bottom: { show: true,  x: 4, y: 40,   w: 54, h: 0.3, color: '#e2d9c8' }
    },
    items: {
      logo:      { x: 64,   y: 3,    w: 16,   show: true },
      title:     { x: 4,    y: 4,    w: 54,   size: 8.6, bold: true,  align: 'right', color: '#1c1a17', show: true },
      subtitle:  { x: 4,    y: 8.6,  w: 54,   size: 5.6, bold: false, align: 'right', color: '#6b6257', show: true },
      photo:     { x: 63,   y: 14.5, w: 18,   show: true },
      name:      { x: 4,    y: 17,   w: 54,   size: 10,  bold: true,  align: 'right', color: '#1c1a17', show: true },
      role:      { x: 4,    y: 24,   w: 54,   size: 7,   bold: true,  align: 'right', color: '#8a6f3c', show: true },
      langs:     { x: 4,    y: 28.8, w: 54,   size: 6.4, bold: false, align: 'right', color: '#55503f', show: true },
      member_no: { x: 4,    y: 33.4, w: 54,   size: 6.6, bold: false, align: 'right', color: '#6b6257', show: true },
      official:  { x: 26,   y: 41.6, w: 32,   size: 6.4, bold: true,  align: 'right', color: '#55503f', show: true },
      valid:     { x: 4,    y: 47,   w: 30,   size: 6,   bold: false, align: 'left',  color: '#55503f', show: true }
    }
  }),
  // ٣) بطاقة فاتحة بخطين ذهبيين بلا شريط داكن
  light: () => ({
    v: 1, custom: [],
    card: { bg: '#fffdf9', border: '#bc9661' },
    band: { show: false, side: 'top', h: 12.5, bg: '#1a232d', line: '#bc9661', lineH: 0.8 },
    rules: {
      top:    { show: true, x: 4, y: 13.4, w: 77.6, h: 0.4, color: '#bc9661' },
      bottom: { show: true, x: 4, y: 39.6, w: 77.6, h: 0.3, color: '#e2d9c8' }
    },
    items: {
      logo:      { x: 68.5, y: 2.2,  w: 14,   show: true, badge: true, badgeBg: '#1a232d' },
      title:     { x: 4,    y: 3.4,  w: 62,   size: 8.6, bold: true,  align: 'right', color: '#1a232d', show: true },
      subtitle:  { x: 4,    y: 8.2,  w: 62,   size: 5.8, bold: false, align: 'right', color: '#8a6f3c', show: true },
      photo:     { x: 68,   y: 16.6, w: 14,   show: true },
      name:      { x: 6,    y: 18,   w: 58,   size: 9.8, bold: true,  align: 'right', color: '#1a232d', show: true },
      role:      { x: 6,    y: 24.4, w: 58,   size: 7,   bold: true,  align: 'right', color: '#8a6f3c', show: true },
      langs:     { x: 6,    y: 29,   w: 58,   size: 6.4, bold: false, align: 'right', color: '#55503f', show: true },
      member_no: { x: 6,    y: 33.4, w: 58,   size: 6.6, bold: false, align: 'right', color: '#6b6257', show: true },
      official:  { x: 44,   y: 41.4, w: 38,   size: 6.6, bold: true,  align: 'right', color: '#55503f', show: true },
      valid:     { x: 5,    y: 47,   w: 36,   size: 6.2, bold: false, align: 'left',  color: '#55503f', show: true }
    }
  })
};

export const DEFAULT_LAYOUT = () => PRESET_LAYOUT.classic();

// عنصر مضاف من المصمِّم: نص أو صورة (والشعار صورة) — (ملاحظة ٩٥)
export const newCustom = (type, i) => ({
  id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  type: type === 'image' ? 'image' : 'text',
  text: type === 'image' ? '' : `نص ${i}`,
  path: null,
  x: 8, y: 20 + (i % 4) * 5, w: type === 'image' ? 16 : 40,
  size: 8, bold: false, align: 'right', color: '#1c1a17', show: true, badge: false
});

const normCustom = c => ({
  id: String(c.id || ''),
  type: c.type === 'image' ? 'image' : 'text',
  text: typeof c.text === 'string' ? c.text.slice(0, 300) : '',
  path: c.path || null,
  x: Number(c.x) || 0, y: Number(c.y) || 0, w: Number(c.w) || 20,
  size: Number(c.size) || 8, bold: c.bold === true,
  align: ['right', 'center', 'left'].includes(c.align) ? c.align : 'right',
  color: typeof c.color === 'string' ? c.color : '#1c1a17',
  show: c.show !== false, badge: c.badge === true
});

export const customLabel = (c, i) => (c.type === 'image' ? `صورة ${i + 1}` : `نص: ${(c.text || '').slice(0, 14) || i + 1}`);

// دمج تصميم محفوظ مع الافتراضي: كل مفتاح ناقص يأخذ قيمته الافتراضية
export function normalizeLayout(saved) {
  const base = DEFAULT_LAYOUT();
  if (!saved || typeof saved !== 'object') return base;
  const out = {
    v: 1,
    card: { ...base.card, ...(saved.card || {}) },
    band: { ...base.band, ...(saved.band || {}) },
    rules: {
      top: { ...base.rules.top, ...((saved.rules || {}).top || {}) },
      bottom: { ...base.rules.bottom, ...((saved.rules || {}).bottom || {}) }
    },
    custom: Array.isArray(saved.custom) ? saved.custom.filter(c => c && c.id).map(normCustom).slice(0, 12) : [],
    items: {}
  };
  for (const key of ITEM_ORDER) out.items[key] = { ...base.items[key], ...((saved.items || {})[key] || {}) };
  return clampLayout(out);
}

const num = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

export function clampLayout(l) {
  const d = DEFAULT_LAYOUT();
  for (const c of (l.custom || [])) {
    c.w = num(c.w, 3, CARD.w, 20);
    c.x = num(c.x, -2, CARD.w - 2, 8);
    c.y = num(c.y, -2, CARD.h - 2, 20);
    c.size = num(c.size, 4, 24, 8);
  }
  l.band.h = num(l.band.h, 0, CARD.w, d.band.h);
  l.band.lineH = num(l.band.lineH, 0, 3, d.band.lineH);
  if (l.band.side !== 'right') l.band.side = 'top';
  for (const k of ['top', 'bottom']) {
    const r = l.rules[k], rd = d.rules[k];
    r.x = num(r.x, 0, CARD.w, rd.x);
    r.y = num(r.y, 0, CARD.h, rd.y);
    r.w = num(r.w, 2, CARD.w, rd.w);
    r.h = num(r.h, 0.1, 3, rd.h);
    r.show = r.show !== false;
  }
  for (const key of ITEM_ORDER) {
    const it = l.items[key], def = d.items[key];
    it.w = num(it.w, 4, CARD.w, def.w);
    it.x = num(it.x, -2, CARD.w - 2, def.x);
    it.y = num(it.y, -2, CARD.h - 2, def.y);
    if ('size' in def) it.size = num(it.size, 4, 24, def.size);
    it.show = it.show !== false;
    if (key === 'logo') it.badge = it.badge === true;
  }
  return l;
}

// ارتفاع الصورة: نسبة ٤×٦ ثابتة
export const photoH = w => w * 1.5;

// نص كل عنصر لعضو بعينه
export function itemText(key, { member, cfg, roleLabel, langsText }) {
  switch (key) {
    case 'title': return cfg.title || '';
    case 'subtitle': return cfg.subtitle || '';
    case 'name': return member.full_name || '';
    case 'role': return roleLabel || '';
    case 'langs': return langsText || '';
    case 'member_no': return member.member_no != null ? `No. ${member.member_no}` : '';
    case 'official': return [cfg.official_name, cfg.official_title].filter(Boolean).join('\n');
    case 'valid': return cfg.valid_until_text ? `سارية حتى ${cfg.valid_until_text}` : '';
    default: return '';
  }
}

// أنماط العنصر بوحدة المليمتر — تصلح للشاشة (بعد التحجيم) وللطباعة
export function itemStyle(it, key) {
  const s = {
    position: 'absolute',
    insetInlineStart: 'auto',
    left: `${it.x}mm`,
    top: `${it.y}mm`,
    width: `${it.w}mm`
  };
  if (key === 'photo') s.height = `${photoH(it.w)}mm`;
  if (it.size) {
    s.fontSize = `${it.size}pt`;
    s.lineHeight = '1.3';
    s.fontWeight = it.bold ? '700' : '400';
    s.textAlign = it.align || 'right';
    s.color = it.color || '#1c1a17';
    s.whiteSpace = 'pre-line';
  }
  return s;
}

// أنماط الشريط: علوي أو جانبي على يمين البطاقة
export function bandStyle(band) {
  if (!band.show) return null;
  return band.side === 'right'
    ? { position: 'absolute', top: '0', left: `${CARD.w - band.h}mm`, width: `${band.h}mm`, height: '100%',
        background: band.bg, borderInlineStart: 'none',
        borderLeft: `${band.lineH}mm solid ${band.line}` }
    : { position: 'absolute', left: '0', top: '0', width: '100%', height: `${band.h}mm`,
        background: band.bg, borderBottom: `${band.lineH}mm solid ${band.line}` };
}

// الشعار أبيض، فإذا كانت البطاقة فاتحة وُضع على مربع داكن ليظهر
export function logoExtra(it) {
  if (!it.badge) return {};
  return { background: it.badgeBg || '#1a232d', borderRadius: '1.2mm', padding: '1mm' };
}

export function ruleStyle(r) {
  if (!r || !r.show) return null;
  return { position: 'absolute', left: `${r.x}mm`, top: `${r.y}mm`, width: `${r.w}mm`,
    height: `${r.h}mm`, background: r.color };
}

const scaleStyle = (style, scale) => {
  if (!style) return null;
  const out = {};
  for (const [k, v] of Object.entries(style)) {
    out[k] = typeof v === 'string' && v.endsWith('mm') ? `${parseFloat(v) * scale}px` : v;
  }
  return out;
};
export { scaleStyle };

// بطاقة جاهزة للعرض (لا للتحرير): يستعملها المترجم في «بياناتي»
// h: دالة بناء العناصر تُمرَّر من الشاشة، scale: بكسل لكل مليمتر
export function staticCard(h, { layout, member, cfg, roleLabel, langsText, logoSrc, photoUrl, customUrls, scale = 6 }) {
  const px = mm => `${mm * scale}px`;
  const kids = [];
  const bs = scaleStyle(bandStyle(layout.band), scale);
  if (bs) kids.push(h('div', { style: bs }));
  for (const k of ['top', 'bottom']) {
    const rs = scaleStyle(ruleStyle(layout.rules[k]), scale);
    if (rs) kids.push(h('div', { style: rs }));
  }
  for (const key of ITEM_ORDER) {
    const it = layout.items[key];
    if (!it.show) continue;
    const style = { ...itemStyle(it, key), left: px(it.x), top: px(it.y), width: px(it.w) };
    if (key === 'photo') style.height = px(photoH(it.w));
    if (it.size) style.fontSize = `${it.size * scale * 25.4 / 72}px`;

    if (key === 'logo') {
      if (!logoSrc) continue;
      kids.push(h('div.cd-item', { style: { ...style, ...logoExtra(it) } },
        h('img', { src: logoSrc, alt: '', style: { width: '100%', height: 'auto', display: 'block' } })));
    } else if (key === 'photo') {
      kids.push(h('div.cd-item.cd-photo', { style },
        photoUrl ? h('img', { src: photoUrl, alt: '' }) : h('span.cd-photo-ph', '٤×٦')));
    } else {
      const text = itemText(key, { member, cfg, roleLabel, langsText });
      if (text) kids.push(h('div.cd-item', { style }, text));
    }
  }
  for (const c of (layout.custom || [])) {
    if (!c.show) continue;
    const st = { ...itemStyle(c, c.type === 'image' ? 'custom-image' : 'custom-text'),
      left: px(c.x), top: px(c.y), width: px(c.w) };
    if (c.size) st.fontSize = `${c.size * scale * 25.4 / 72}px`;
    if (c.type === 'image') {
      const src = (customUrls || {})[c.id];
      if (!src) continue;
      kids.push(h('div.cd-item', { style: { ...st, ...logoExtra(c) } },
        h('img', { src, alt: '', style: { width: '100%', height: 'auto', display: 'block' } })));
    } else if (c.text) {
      kids.push(h('div.cd-item', { style: st }, c.text));
    }
  }

  return h('div.card-stage.view', { style: {
    width: px(CARD.w), height: px(CARD.h), background: layout.card.bg, borderColor: layout.card.border } }, kids);
}
