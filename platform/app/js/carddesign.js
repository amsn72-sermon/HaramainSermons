// نموذج تصميم بطاقة العمل: مقاسات بالمليمتر وخطوط بالنقطة (ملاحظة ٨٦)
import { qrDataUri } from './qr.js';
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
  valid: 'الصلاحية',
  qr: 'باركود التحقق'
};
export const ITEM_ORDER = ['logo', 'title', 'subtitle', 'photo', 'name', 'role', 'langs', 'member_no', 'official', 'valid', 'qr'];
export const TEXT_ITEMS = ITEM_ORDER.filter(k => k !== 'logo' && k !== 'photo' && k !== 'qr');

// صفحةُ التحقق من البطاقة: تُثبتها ولا تُفشي صاحبَها (ملاحظة ٣١٣)
export const cardVerifyUrl = (no, key) =>
  `https://haramainsermons.com/verify-card?no=${encodeURIComponent(no ?? '')}`
  + `&k=${encodeURIComponent(key || '')}`;

// خطوط البطاقة: خط المنصة المرفق، وخطوط النظام الشائعة في الطباعة (ملاحظة ١٠٠)
export const CARD_FONTS = [
  ['haramain', 'خط المنصة',  "'Haramain Arabic', 'HS', 'Segoe UI', Tahoma, sans-serif"],
  ['naskh',    'نسخ',        "'Noto Naskh Arabic', 'Traditional Arabic', 'Amiri', serif"],
  ['kufi',     'كوفي',       "'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif"],
  ['tahoma',   'تاهوما',     "Tahoma, 'Segoe UI', Arial, sans-serif"],
  ['arial',    'أريال',      "Arial, Helvetica, sans-serif"],
  ['times',    'تايمز',      "'Times New Roman', 'Traditional Arabic', serif"]
];
export const FONT_KEYS = CARD_FONTS.map(f => f[0]);
export const fontStack = key => (CARD_FONTS.find(f => f[0] === key) || CARD_FONTS[0])[2];

export const COLORS = [
  ['#ffffff', 'أبيض'], ['#1c1a17', 'أسود'], ['#1a232d', 'كحلي'],
  ['#8a6f3c', 'ذهبي داكن'], ['#bc9661', 'ذهبي'], ['#d5bd87', 'ذهبي فاتح'],
  ['#55503f', 'رمادي داكن'], ['#6b6257', 'رمادي'], ['#2f6b52', 'أخضر']
];

// ثلاثة قوالب جاهزة: يختار المدير أقربها إلى ما يريد ثم يعدّل عليه
export const PRESETS = [
  ['classic',  'رسمي داكن — شريط علوي'],
  ['haramain', 'الحرمين — رأسٌ داكن وحقلٌ مؤطَّر'],
  ['sidebar',  'شريط جانبي — الصورة والشعار معًا'],
  ['light',    'فاتح بإطار ذهبي']
];

export const PRESET_LAYOUT = {
  // ٠) «الحرمين»: رأسٌ داكن تحته خطٌّ ذهبي، والاسمُ في حقلٍ مؤطَّر،
  //    والصورةُ إلى يسار البيانات، وسطرٌ أسفل للصلاحية والتوقيع
  haramain: () => ({
    v: 1, custom: [],
    card: { bg: '#ffffff', border: '#bc9661' },
    band: { show: true, side: 'top', h: 14.5, bg: '#1a232d', line: '#bc9661', lineH: 1 },
    rules: {
      top:    { show: false, x: 4, y: 15.8, w: 77.6, h: 0.3, color: '#bc9661' },
      bottom: { show: true,  x: 5, y: 41.2, w: 75.6, h: 0.3, color: '#d8cfbd' }
    },
    items: {
      logo:      { x: 68.5, y: 2.2,  w: 14,   show: true },
      title:     { x: 4,    y: 3.4,  w: 62,   size: 9.2, bold: true,  align: 'right', color: '#ffffff', show: true },
      subtitle:  { x: 4,    y: 8.8,  w: 62,   size: 6,   bold: false, align: 'right', color: '#d5bd87', show: true },
      photo:     { x: 66.5, y: 18,   w: 15,   show: true },
      name:      { x: 5,    y: 18.6, w: 58,   size: 9.6, bold: true,  align: 'right', color: '#1c1a17',
                   box: true, boxColor: '#bc9661', boxW: 0.4, show: true },
      role:      { x: 6,    y: 26.4, w: 56,   size: 7,   bold: true,  align: 'right', color: '#8a6f3c', show: true },
      langs:     { x: 6,    y: 30.8, w: 56,   size: 6.6, bold: false, align: 'right', color: '#55503f', show: true },
      member_no: { x: 6,    y: 35,   w: 56,   size: 6.8, bold: false, align: 'right', color: '#6b6257', show: true },
      official:  { x: 44,   y: 42.6, w: 37,   size: 6.4, bold: true,  align: 'right', color: '#55503f', show: true },
      valid:     { x: 5,    y: 42.6, w: 36,   size: 6.2, bold: false, align: 'left',  color: '#55503f', show: true },
      qr:        { x: 4,    y: 40,   w: 11,   show: false }
    }
  }),

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
      valid:     { x: 5,    y: 47,   w: 36,   size: 6.2, bold: false, align: 'left',  color: '#55503f', show: true },
      qr:        { x: 4,    y: 40,   w: 11,   show: false }
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
      valid:     { x: 4,    y: 47,   w: 30,   size: 6,   bold: false, align: 'left',  color: '#55503f', show: true },
      qr:        { x: 4,    y: 40,   w: 11,   show: false }
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
      valid:     { x: 5,    y: 47,   w: 36,   size: 6.2, bold: false, align: 'left',  color: '#55503f', show: true },
      qr:        { x: 4,    y: 40,   w: 11,   show: false }
    }
  })
};

// القالبُ الافتراضيّ، ومعه الخلفيةُ والأشكالُ والعلامةُ المائية فارغةً —
//   فلا يُطلَب منها مفتاحٌ غيرُ موجود (ملاحظة ٣٩٥)
export const DEFAULT_LAYOUT = () => withExtras(PRESET_LAYOUT.classic());
export const withExtras = l => Object.assign(l, {
  bg: l.bg || BG_DEFAULT(), wm: l.wm || WM_DEFAULT(),
  shapes: Array.isArray(l.shapes) ? l.shapes : []
});

// ---------------------------------------------------------------------
// خلفيةٌ تملأ البطاقة، وأشكالٌ تُرسم عليها، وعلامةٌ مائية (ملاحظة ٣٩٥)
//
//   يُدرَج تصميمٌ خارجيٌّ صورةً فيملأ البطاقة، وتُرسم فوقه الأشكالُ
//   والنصوص. والعلامةُ المائية تحت العناصر لا فوقها، فلا تحجب البيانات.
// ---------------------------------------------------------------------
export const BG_DEFAULT = () => ({ path: null, fit: 'cover', fade: 0, show: true });
export const WM_DEFAULT = () => ({
  show: false, text: '', path: null, x: 22, y: 16, w: 42,
  size: 16, color: '#bc9661', fade: 0.14, rot: -20
});

export const SHAPE_KINDS = [
  ['rect',   'مستطيل'], ['circle', 'دائرة'],
  ['line',   'خط'],     ['frame',  'إطار']
];
export const shapeLabel = (s, i) =>
  `${(SHAPE_KINDS.find(k => k[0] === s.kind) || SHAPE_KINDS[0])[1]} ${i + 1}`;

export const newShape = (kind, i) => ({
  id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  kind: SHAPE_KINDS.some(k => k[0] === kind) ? kind : 'rect',
  x: 6, y: 14 + (i % 4) * 5, w: kind === 'line' ? 40 : 22, h: kind === 'line' ? 0.6 : 12,
  color: '#bc9661', stroke: 0.5, fill: kind !== 'frame' && kind !== 'line',
  radius: 1.2, fade: 1, show: true
});

const normShape = s => ({
  id: String(s.id || ''),
  kind: SHAPE_KINDS.some(k => k[0] === s.kind) ? s.kind : 'rect',
  x: Number(s.x) || 0, y: Number(s.y) || 0,
  w: Number(s.w) || 10, h: Number(s.h) || 6,
  color: typeof s.color === 'string' ? s.color : '#bc9661',
  stroke: Number(s.stroke) || 0.5, fill: s.fill === true,
  radius: Number(s.radius) || 0, fade: Number(s.fade) >= 0 ? Number(s.fade) : 1,
  show: s.show !== false
});

// أنماطُ الشكل بالمليمتر — تصلح للشاشة وللطباعة معًا
export function shapeStyle(s) {
  const st = {
    position: 'absolute', left: `${s.x}mm`, top: `${s.y}mm`,
    width: `${s.w}mm`, height: `${s.kind === 'line' ? Math.max(0.2, s.stroke) : s.h}mm`,
    opacity: String(s.fade ?? 1), boxSizing: 'border-box'
  };
  if (s.kind === 'line') { st.background = s.color; return st; }
  if (s.kind === 'circle') st.borderRadius = '50%';
  else if (s.radius) st.borderRadius = `${s.radius}mm`;
  if (s.fill) st.background = s.color;
  else st.border = `${Math.max(0.1, s.stroke)}mm solid ${s.color}`;
  return st;
}

export const bgStyle = bg => (bg && bg.show && bg.path ? {
  position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
  objectFit: bg.fit === 'contain' ? 'contain' : 'cover',
  opacity: String(1 - (Number(bg.fade) || 0))
} : null);

export function wmStyle(wm) {
  if (!wm || !wm.show) return null;
  return {
    position: 'absolute', left: `${wm.x}mm`, top: `${wm.y}mm`, width: `${wm.w}mm`,
    opacity: String(wm.fade ?? 0.14), color: wm.color || '#bc9661',
    fontSize: `${wm.size}pt`, fontWeight: '700', textAlign: 'center',
    transform: `rotate(${wm.rot || 0}deg)`, transformOrigin: 'center',
    whiteSpace: 'pre-line', pointerEvents: 'none'
  };
}

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
  font: FONT_KEYS.includes(c.font) ? c.font : '',
  show: c.show !== false, badge: c.badge === true
});

export const customLabel = (c, i) => (c.type === 'image' ? `صورة ${i + 1}` : `نص: ${(c.text || '').slice(0, 14) || i + 1}`);

// دمج تصميم محفوظ مع الافتراضي: كل مفتاح ناقص يأخذ قيمته الافتراضية
export function normalizeLayout(saved) {
  const base = DEFAULT_LAYOUT();
  if (!saved || typeof saved !== 'object') return base;
  const out = {
    v: 1,
    font: FONT_KEYS.includes(saved.font) ? saved.font : 'haramain',
    card: { ...base.card, ...(saved.card || {}) },
    band: { ...base.band, ...(saved.band || {}) },
    rules: {
      top: { ...base.rules.top, ...((saved.rules || {}).top || {}) },
      bottom: { ...base.rules.bottom, ...((saved.rules || {}).bottom || {}) }
    },
    custom: Array.isArray(saved.custom) ? saved.custom.filter(c => c && c.id).map(normCustom).slice(0, 12) : [],
    // خلفيةٌ وأشكالٌ وعلامةٌ مائية (ملاحظة ٣٩٥)
    bg: { ...BG_DEFAULT(), ...(saved.bg || {}) },
    wm: { ...WM_DEFAULT(), ...(saved.wm || {}) },
    shapes: Array.isArray(saved.shapes) ? saved.shapes.filter(s => s && s.id).map(normShape).slice(0, 16) : [],
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
  if (!l.bg) l.bg = BG_DEFAULT();
  if (!l.wm) l.wm = WM_DEFAULT();
  if (!Array.isArray(l.shapes)) l.shapes = [];
  l.bg.fade = num(l.bg.fade, 0, 0.95, 0);
  if (l.bg.fit !== 'contain') l.bg.fit = 'cover';
  l.wm.x = num(l.wm.x, -2, CARD.w - 2, 22);
  l.wm.y = num(l.wm.y, -2, CARD.h - 2, 16);
  l.wm.w = num(l.wm.w, 6, CARD.w, 42);
  l.wm.size = num(l.wm.size, 4, 40, 16);
  l.wm.fade = num(l.wm.fade, 0.02, 1, 0.14);
  l.wm.rot = num(l.wm.rot, -90, 90, -20);
  for (const s of l.shapes) {
    s.w = num(s.w, 0.3, CARD.w, 20);
    s.h = num(s.h, 0.2, CARD.h, 10);
    s.x = num(s.x, -2, CARD.w - 2, 6);
    s.y = num(s.y, -2, CARD.h - 2, 14);
    s.stroke = num(s.stroke, 0.1, 4, 0.5);
    s.radius = num(s.radius, 0, 12, 1.2);
    s.fade = num(s.fade, 0.05, 1, 1);
  }
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
    // أجلُ البطاقة: ما حُدِّد لصاحبها عند الاعتماد مقدَّمٌ على العامّ
    //   (ملاحظة ٤٠٢)
    case 'valid': {
      const t = member?.valid_until_text || cfg.valid_until_text;
      return t ? `سارية حتى ${t}` : '';
    }
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
    if (it.font && FONT_KEYS.includes(it.font)) s.fontFamily = fontStack(it.font);
  }
  // إطارٌ حول العنصر إن طُلب: حقلٌ مؤطَّر كما في قالب «الحرمين»
  if (it.box) {
    s.border = `${it.boxW || 0.4}mm solid ${it.boxColor || '#bc9661'}`;
    s.borderRadius = '1.2mm';
    s.padding = '0.8mm 1.6mm';
    s.boxSizing = 'border-box';
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
  // الخلفيةُ أولًا فتكون تحت الجميع (ملاحظة ٣٩٥)
  const bgSrc = (customUrls || {}).__bg;
  const bgs = scaleStyle(bgStyle(layout.bg), scale);
  if (bgs && bgSrc) kids.push(h('img', { src: bgSrc, alt: '', style: bgs }));
  const bs = scaleStyle(bandStyle(layout.band), scale);
  if (bs) kids.push(h('div', { style: bs }));
  for (const k of ['top', 'bottom']) {
    const rs = scaleStyle(ruleStyle(layout.rules[k]), scale);
    if (rs) kids.push(h('div', { style: rs }));
  }
  for (const s of (layout.shapes || [])) {
    if (!s.show) continue;
    kids.push(h('div', { style: scaleStyle(shapeStyle(s), scale) }));
  }
  const wms = scaleStyle(wmStyle(layout.wm), scale);
  if (wms) {
    const wmSrc = (customUrls || {}).__wm;
    if (wms.fontSize) wms.fontSize = `${layout.wm.size * scale * 25.4 / 72}px`;
    if (wmSrc) kids.push(h('div', { style: wms },
      h('img', { src: wmSrc, alt: '', style: { width: '100%', height: 'auto', display: 'block' } })));
    else if (layout.wm.text) kids.push(h('div', { style: wms }, layout.wm.text));
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
        photoUrl ? h('img', { src: photoUrl, alt: '' }) : h('span.cd-photo-ph', '4×6')));
    } else if (key === 'qr') {
      // باركودُ التحقق: يُثبت البطاقةَ ولا يُفشي صاحبَها (ملاحظة ٣١٣)
      const src = qrDataUri(cardVerifyUrl(member.member_no, member.card_key),
        { margin: 0, dark: it.color || '#1c1a17' });
      kids.push(h('div.cd-item', { style: { ...style, height: px(it.w) } },
        h('img', { src, alt: 'رمز التحقق',
          style: { width: '100%', height: '100%', display: 'block' } })));
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
    width: px(CARD.w), height: px(CARD.h), background: layout.card.bg, borderColor: layout.card.border,
    fontFamily: fontStack(layout.font) } }, kids);
}
