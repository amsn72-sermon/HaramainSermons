// مصمِّمُ قوالب مجمَّع الخطب السنوي (ملاحظات ٣٣٩ و٣٥٠ و٣٥٥)
//
//   على آليّة مصمِّم الشهادات: لوحةٌ تُرى وأدواتٌ تحتها، لا حقولٌ
//   لا يُعرَف أثرُها إلا بعد البناء.
//
//   والعرضُ على نسقِ الكتاب نفسِه كما طُلب في ملاحظة ٣٥٥: الغلافُ
//   وحدَه، ثم الصفحتان اللتان بعده مفتوحتين — واحدةٌ يمينًا وأخرى
//   يسارًا — ثم صفحةُ عنوان الخطبة ومتنُها اللذان يتقابلان في الكتاب،
//   ثم ظهرُ الكتاب. ولوحةُ الأدوات واحدةٌ لكلِّ الصفحات: ما يعمُّ
//   القالبَ في صدرها، وما يخصُّ الصفحةَ المحدَّدةَ تحته — صورُها
//   تُضاف وتُحرَّك وتُحذَف، ونصوصُها الحرّةُ كذلك، وترقيمُها.
import { h, fill, toast, busy, dialog, confirm, emptyState } from '../ui.js';
import { db } from '../sb.js';
import { isManager, can } from '../store.js';
import { unifiedPanel } from '../unipanel.js';
import { SIZES, COVER_BGS, BOOK_MARKS, DEFAULT_TPL, TPL_SLOTS, slotOf,
         HIDEABLE, isOff, setOff, BOOK_FONTS,
         BASMALA_IMG, BASMALA_BAND, pennantSvg, footOrnamentSvg } from '../sermonbook.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });
const may = () => isManager() || can('arch_design') || can('arch_export');

// القالبُ المحفوظُ قد تنقصه مفاتيحُ المصمِّم، فيُستكمَل بالافتراضي
function merge(saved) {
  const base = DEFAULT_TPL();
  const out = { ...base, ...(saved || {}) };
  for (const k of [...TPL_SLOTS, 'margins']) {
    out[k] = { ...(base[k] || {}), ...((saved || {})[k] || {}) };
  }
  if (!Array.isArray(out.cover.marks) || !out.cover.marks.length) {
    out.cover.marks = BOOK_MARKS.map(m => ({ ...m }));
  }
  for (const k of TPL_SLOTS) slotOf(out, k);
  return out;
}

const PAGE_LABEL = {
  cover:    'الغلاف',
  front:    'صفحةُ البسملة',
  colophon: 'صفحةُ الحقوق',
  divider:  'صفحةُ عنوان الخطبة',
  inner:    'الصفحةُ الداخلية',
  inner2:   'الصفحةُ المقابلة',
  back:     'ظهرُ الكتاب'
};

// صفحتا المتن وجهانِ لتصميمٍ واحد: ما يُضبَط في إحداهما يسري على
//   أختها، فالكتابُ لا يُصمَّم صفحتين مختلفتين في متنه (ملاحظة ٣٩٢)
const SLOT_OF = k => (k === 'inner2' ? 'inner' : k);

export async function render(ctx) {
  if (!may()) return h('p.muted', 'تصميمُ قوالب المجمَّع بإذن مدير المشروع.');

  let rows = [];
  try { rows = await db.rpc('book_templates_list') || []; } catch { rows = []; }

  // قائمةُ القوالب لا تحمل تصميمَها، فيُقرأ تصميمُ القالب عند فتحه وعند
  //   تبديله — وكان يُغفَل فيُفتَح المصمِّمُ على الافتراضيِّ أبدًا، فإذا
  //   حُفظ مُحي ما قبله (ملاحظة ٤٥٦)
  const tplCache = new Map();
  async function tplOf(id) {
    if (!id) return null;
    if (tplCache.has(id)) return tplCache.get(id);
    let got = null;
    try {
      const r = await db.rpc('book_template_get', { p_id: id });
      got = ((Array.isArray(r) ? r[0] : r) || {}).tpl || null;
    } catch (e) { toast(e.message, 'bad'); got = null; }
    tplCache.set(id, got);
    return got;
  }

  const wanted = ctx?.query?.get('id') || '';
  let cur = rows.find(r => r.id === wanted) || rows.find(r => r.is_default) || rows[0] || null;
  let t = merge(await tplOf(cur?.id));
  let name = cur?.name || 'قالبٌ جديد';
  let forYear = cur?.h_year || null;
  let isDefault = !!cur?.is_default;

  const stage = h('div.bd-stage');
  const props = h('div.bd-props');
  const bar = h('div.bd-bar');
  let page = 'cover';

  const SH = () => SIZES[t.size] || SIZES.book;

  // -------------------------------------------------------------------
  // الصورُ والنصوصُ الحرّةُ تُرسَم على الصفحة المصغَّرة كما تُرسَم في
  //   الكتاب — بالنسبة نفسِها (ملاحظة ٣٥٥)
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // الاختيارُ المباشر (ملاحظة ٤٤٣): يُضغَط العنصرُ على الصفحة نفسِها
  //   فيُحدَّد، ويُنقَل بالسحب، وتُعدَّل خصائصُه في بطاقته، ويُحذَف منها.
  //   وما لا يُنقَل — كالنقش والترويسة — يُحدَّد ويُرفَع ويُعاد.
  // -------------------------------------------------------------------
  let objSel = null;                 // { page, type, i }
  const SEL_LABEL = {
    mark: 'صورة', text: 'نصّ', shape: 'شكل', band: 'الشريط',
    wm: 'العلامةُ المائية', banner: 'الراية', title: 'كتلةُ العنوان',
    foot: 'سطرا الذيل', pattern: 'النقشُ الباهت', coverbg: 'صورةُ الغلاف',
    stamp: 'ختمُ التاريخ', head: 'ترويسةُ الصفحة', orn: 'زخرفةُ الذيل',
    pno: 'رقمُ الصفحة', bsm: 'البسملة', colo: 'كتلةُ الحقوق',
    pagebg: 'خلفيةُ الصفحة', covermark: 'شعار',
    coloqr: 'باركودُ الحقوق', kh: 'سطرُ «الخطبة الأولى»',
    blurb: 'نبذةُ الظهر', bandimg: 'شريطُ البسملة'
  };
  const SHAPE_LABEL = { rect: 'مستطيل', circle: 'دائرة', line: 'خطّ', frame: 'إطار' };

  const same = (a, b) => a && b && a.page === b.page && a.type === b.type && a.i === b.i;

  // يُعلَّم العنصرُ المرسوم بما يمثّله، فالضغطةُ تعرف صاحبَها
  function tag(el, type, i = null) {
    if (!el) return el;
    el.classList.add('bd-obj');
    el.__sel = { type, i };
    if (same(objSel, { page, type, i })) el.classList.add('sel');
    return el;
  }

  // ـــ ما يمثّله المحدَّد: كائنُه، وكيف يُنقَل، وكيف يُرفَع
  function selTarget(sl) {
    if (!sl) return null;
    const S = SH();
    const s = slotOf(t, SLOT_OF(sl.page));
    const cv = t.cover, dv = t.divider, inn = t.inner;
    const bk = (t.back || (t.back = {}));
    const mm2pct = v => (Number(v || 0) / S.h) * 100;
    switch (sl.type) {
      case 'mark': return { obj: s.marks[sl.i], arr: s.marks, move: 'xy' };
      case 'covermark': return { obj: cv.marks[sl.i], arr: cv.marks, move: 'xy' };
      case 'text': return { obj: s.texts[sl.i], arr: s.texts, move: 'xy' };
      case 'shape': return { obj: s.shapes[sl.i], arr: s.shapes, move: 'xy' };
      case 'pagebg': return { obj: s,
        off: () => { s.bg = null; s.bgName = null; } };
      case 'kh': case 'bsm': case 'colo': case 'coloqr': case 'blurb':
        return { obj: s, off: () => { setOff(t, SLOT_OF(sl.page), sl.type, true); } };
      case 'band': return { obj: s.band, off: () => { s.band.on = false; } };
      case 'wm': return { obj: s.wm,
        off: () => { s.wm = { src: null, size: 50, opacity: 8 }; } };
      case 'coverbg': return sl.page === 'back'
        ? { obj: bk, off: () => { setOff(t, 'back', 'coverbg', true); bk.bg = null; } }
        : { obj: cv, off: () => { setOff(t, 'cover', 'coverbg', true); cv.bg = null; } };
      case 'pattern': return { obj: sl.page === 'back' ? bk : cv,
        off: () => { setOff(t, sl.page === 'back' ? 'back' : 'cover', 'pattern', true); } };
      case 'banner':
        if (sl.page === 'cover') {
          return { obj: cv, move: 'y',
            get: () => mm2pct(cv.bannerTop ?? 26),
            set: p => { cv.bannerTop = Math.max(0, Math.min(80,
              Math.round((p / 100) * S.h))); },
            off: () => { setOff(t, 'cover', 'banner', true); } };
        }
        if (sl.page === 'back') return { obj: bk, off: () => { setOff(t, 'back', 'banner', true); } };
        return { obj: dv, off: () => { setOff(t, 'divider', 'banner', true); } };
      case 'title':
        if (sl.page === 'cover') {
          return { obj: cv, move: 'y', get: () => cv.titleY ?? 52,
            set: p => { cv.titleY = Math.max(20, Math.min(80, Math.round(p))); },
            off: () => { setOff(t, 'cover', 'title', true); } };
        }
        return { obj: dv, move: 'y', get: () => dv.midY ?? 62,
          set: p => { dv.midY = Math.max(20, Math.min(90, Math.round(p))); },
          off: () => { setOff(t, 'divider', 'title', true); } };
      case 'foot': return { obj: sl.page === 'back' ? bk : cv,
        off: () => { setOff(t, sl.page === 'back' ? 'back' : 'cover', 'foot', true); } };
      case 'stamp': return { obj: dv, off: () => { setOff(t, 'divider', 'stamp', true); } };
      case 'head': return { obj: inn, off: () => { setOff(t, 'inner', 'head', true); } };
      case 'orn': return { obj: inn, off: () => { setOff(t, 'inner', 'ornament', true); } };
      case 'pno': return { obj: inn, off: () => { setOff(t, 'inner', 'foot', true); } };
      case 'bandimg': return { obj: inn, off: () => { setOff(t, 'inner', 'band', true); } };
      default: return { obj: null };
    }
  }

  function selName(sl) {
    if (!sl) return '';
    if (sl.type === 'shape') {
      const sh = slotOf(t, SLOT_OF(sl.page)).shapes[sl.i];
      return SHAPE_LABEL[sh?.kind] || 'شكل';
    }
    return SEL_LABEL[sl.type] || 'عنصر';
  }

  function deco(key) {
    const S = SH();
    const s = slotOf(t, key);
    const out = [];
    if (s.bg) {
      out.push(tag(h('img.bd-bg', { src: s.bg, alt: '', style: {
        objectFit: s.bgFit === 'contain' ? 'contain' : 'cover',
        opacity: s.bgFade != null ? String(Math.max(0, Math.min(100, s.bgFade)) / 100) : null } }),
        'pagebg'));
    }
    for (const sh of s.shapes) {
      if (!sh) continue;
      const st = {
        insetInlineStart: `${sh.x ?? 10}%`, top: `${sh.y ?? 10}%`,
        width: `${sh.w ?? 30}%`, height: `${sh.h ?? 6}%`,
        opacity: String(Math.max(0, Math.min(100, sh.opacity ?? 100)) / 100)
      };
      if (sh.kind === 'line') {
        st.height = `${((Math.max(0.2, sh.thick ?? 0.6)) / S.h) * 100}%`;
        st.background = sh.color || '#b9975b';
      } else if (sh.kind === 'frame') {
        st.border = `1px solid ${sh.color || '#b9975b'}`;
      } else {
        st.background = sh.color || '#b9975b';
        if (sh.kind === 'circle') st.borderRadius = '50%';
      }
      out.push(tag(h('div.bd-sh', { style: st }), 'shape', s.shapes.indexOf(sh)));
    }
    if (s.band && s.band.on) {
      out.push(tag(h('div.bd-band', { style: {
        height: `${((s.band.h ?? 10) / S.h) * 100}%`,
        background: s.band.color || '#174a38',
        opacity: String(Math.max(0, Math.min(100, s.band.opacity ?? 100)) / 100),
        top: s.band.top ? '0' : 'auto', bottom: s.band.top ? 'auto' : '0' } }), 'band'));
    }
    if (s.wm && s.wm.src) {
      out.push(tag(h('div.bd-wm', h('img', { src: s.wm.src, alt: '', style: {
        width: `${Math.max(10, Math.min(100, s.wm.size ?? 50))}%`,
        opacity: String(Math.max(1, Math.min(60, s.wm.opacity ?? 8)) / 100) } })), 'wm'));
    }
    for (const m of s.marks) {
      if (!m || !m.src) continue;
      out.push(tag(h('img.bd-mk', { src: m.src, alt: '', style: {
        insetInlineStart: `${m.x}%`, top: `${m.y}%`, height: `${(m.h / S.h) * 100}%`,
        opacity: m.opacity != null ? String(Math.max(0, Math.min(100, m.opacity)) / 100) : null } }),
        'mark', s.marks.indexOf(m)));
    }
    for (const x of s.texts) {
      if (!x || !String(x.text || '').trim()) continue;
      out.push(tag(h('div.bd-tx', { style: {
        insetInlineStart: `${x.x ?? 10}%`, top: `${x.y ?? 10}%`, width: `${x.w ?? 80}%`,
        fontSize: `${((x.size ?? 4) / S.w) * 100}cqw`, color: x.color || '#174a38',
        textAlign: x.align || 'center', fontWeight: x.bold ? '700' : '400' } },
        String(x.text)), 'text', s.texts.indexOf(x)));
    }
    return out;
  }

  function miniCover() {
    const S = SH();
    const p = h('div.bd-page', { style: { background: t.cover.paper } });
    if (t.cover.pattern && !isOff(t, 'cover', 'pattern')) {
      p.append(tag(h('div.bd-pat', { style: { '--g': t.cover.gold } }), 'pattern'));
    }
    if (t.cover.bg && !isOff(t, 'cover', 'coverbg')) {
      p.append(tag(h('img.bd-cover-bg', { src: t.cover.bg, alt: '',
        style: { opacity: String(Math.max(0, Math.min(100, t.cover.fade)) / 100) } }), 'coverbg'));
    }
    t.cover.marks.forEach((m, i) => {
      p.append(tag(h('img.bd-mk', { src: m.src, alt: '', style: {
        insetInlineStart: `${m.x}%`, top: `${m.y}%`, height: `${(m.h / S.h) * 100}%` } }),
        'covermark', i));
    });
    if (!isOff(t, 'cover', 'banner') && Number(t.cover.bannerW) > 0) {
      const b = h('div.bd-banner', { style: {
        top: `${((t.cover.bannerTop ?? 26) / S.h) * 100}%`,
        width: `${(Number(t.cover.bannerW) / S.w) * 100}%` } });
      b.innerHTML = pennantSvg(t.cover.ink, t.cover.gold);
      p.append(tag(b, 'banner'));
    }
    if (!isOff(t, 'cover', 'title')) p.append(tag(h('div.bd-mid', { style: { top: `${t.cover.titleY ?? 52}%` } },
      h('b.bd-t1', { style: { color: t.cover.ink } }, 'مجمَّع الخطب السنوي'),
      h('div.bd-rule', { style: { background: t.cover.gold } }),
      h('div.bd-t2', { style: { color: t.cover.gold } }, 'لخُطب المسجد الحرام المترجمة'),
      h('div.bd-t3', { style: { color: t.cover.gold } }, 'إلى الإنجليزية'),
      h('div.bd-t4', { style: { color: t.cover.ink } }, 'لعام ١٤٤٥هـ')), 'title'));
    if (!isOff(t, 'cover', 'foot')) {
      p.append(tag(h('div.bd-foot', { style: { color: t.cover.ink } },
        h('span', 'الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'),
        h('span', 'مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين — بتنفيذ جامعة أمِّ القرى')),
        'foot'));
    }
    p.append(...deco('cover'));
    return p;
  }

  function miniDivider() {
    const S = SH();
    const p = h('div.bd-page', { style: { background: t.divider.paper } });
    if (!isOff(t, 'divider', 'banner') && t.divider.banner && Number(t.divider.bannerW) > 0) {
      const b = h('div.bd-banner', { style: { top: '0',
        width: `${(Number(t.divider.bannerW) / S.w) * 100}%` } });
      b.innerHTML = pennantSvg(t.divider.ink, t.cover.gold);
      p.append(tag(b, 'banner'));
    }
    if (t.divider.ghost && t.cover.bg) p.append(h('img.bd-ghost', { src: t.cover.bg, alt: '' }));
    if (!isOff(t, 'divider', 'stamp')) {
      p.append(tag(h('div.bd-stamp', { style: { color: t.divider.ink } },
        h('div', 'خطبـة الجمعة'), h('div', '٧ محرم ١٤٤٤هـ'), h('div', 'الموافق 2022/8/5م')),
        'stamp'));
    }
    if (!isOff(t, 'divider', 'title')) p.append(tag(h('div.bd-mid', { style: { top: `${t.divider.midY ?? 62}%` } },
      h('div.bd-t3', { style: { color: t.divider.ink } }, 'موضـوع الخطبة:'),
      h('b.bd-t1', { style: { color: t.divider.ink } }, 'راحـة البال'),
      h('div.bd-t3', { style: { color: t.divider.ink, marginTop: '4%' } }, 'لفضيـلة الشيـخ'),
      h('b.bd-t2', { style: { color: t.divider.ink } }, 'د. سعود بن إبراهيم الشريم'),
      h('div.bd-rule', { style: { background: t.cover.gold } })), 'title'));
    p.append(...deco('divider'));
    return p;
  }

  function miniInner() {
    const p = h('div.bd-page', { style: { background: t.inner.paper } });
    if (t.inner.head && !isOff(t, 'inner', 'head')) {
      p.append(tag(h('div.bd-head', { style: { color: t.inner.gold,
        borderBottom: `1px solid ${t.inner.gold}` } },
        h('span', 'مجمَّع الخطب السنوي'), h('span', 'لعام ١٤٤٥هـ')), 'head'));
    }
    const win = h('div.bd-win');
    // شريطُ البسملة اسمُه غيرُ اسم الشريط الملوَّن، فلا تتداخل قواعدُهما
    //   ولا تضيع الضغطةُ عليه (ملاحظة ٤٥٥)
    if (t.inner.band && !isOff(t, 'inner', 'band')) {
      win.append(tag(h('img.bd-bsmband', { src: BASMALA_BAND, alt: '' }), 'bandimg'));
    }
    if (!isOff(t, 'inner', 'kh')) {
      win.append(tag(h('div.bd-kh', { style: { color: t.cover.ink } }, '(الخطبةُ الأولى)'), 'kh'));
    }
    for (let i = 0; i < 9; i++) {
      win.append(h('div.bd-line', { style: { background: t.inner.ink,
        width: i % 4 === 3 ? '62%' : '100%' } }));
    }
    p.append(win);
    if (t.inner.ornament && !isOff(t, 'inner', 'ornament')) {
      const o = h('div.bd-orn');
      o.innerHTML = footOrnamentSvg(t.inner.gold);
      p.append(tag(o, 'orn'));
    }
    if (t.inner.foot && !isOff(t, 'inner', 'foot')) {
      p.append(tag(h('div.bd-no',
        h('span', { class: `pno ${t.inner.pageno || 'circle'}`,
          style: { color: t.inner.ink, borderColor: t.inner.gold } },
          AR(t.inner.numStart ?? 1))), 'pno'));
    }
    p.append(...deco('inner'));
    return p;
  }

  function miniBasmala() {
    const p = h('div.bd-page', { style: { background: t.inner.paper } });
    if (!isOff(t, 'front', 'bsm')) {
      p.append(tag(h('div.bd-bsm', h('img', { src: BASMALA_IMG, alt: 'البسملة' })), 'bsm'));
    }
    p.append(...deco('front'));
    return p;
  }

  function miniColophon() {
    const p = h('div.bd-page', { style: { background: t.inner.paper } });
    const box = h('div.bd-colo', { style: { color: t.inner.ink } },
      h('b', { style: { color: t.cover.ink, borderBottom: `1px solid ${t.cover.gold}` } },
        'مجمَّع الخطب السنوي'),
      h('div.bd-line', { style: { background: t.inner.ink, width: '92%' } }),
      h('div.bd-line', { style: { background: t.inner.ink, width: '80%' } }),
      h('div.bd-rights', { style: { borderColor: t.cover.gold } },
        String(t.colophon?.rights || 'حقوقُ الطبع محفوظة…').slice(0, 90)),
      isOff(t, 'colophon', 'coloqr') ? null
        : tag(h('div.bd-qr', { style: { borderColor: t.inner.ink } }), 'coloqr'));
    if (!isOff(t, 'colophon', 'colo')) p.append(tag(box, 'colo'));
    p.append(...deco('colophon'));
    return p;
  }

  function miniBack() {
    const S = SH();
    const b = t.back || {};
    const p = h('div.bd-page', { style: { background: b.paper || t.cover.paper } });
    if (b.pattern && !isOff(t, 'back', 'pattern')) {
      p.append(tag(h('div.bd-pat', { style: { '--g': b.gold || t.cover.gold } }), 'pattern'));
    }
    if (b.bg && !isOff(t, 'back', 'coverbg')) {
      p.append(tag(h('img.bd-cover-bg', { src: b.bg, alt: '',
        style: { opacity: String(Math.max(0, Math.min(100, b.fade ?? 16)) / 100) } }), 'coverbg'));
    }
    if (!isOff(t, 'back', 'banner')) {
      const bn = h('div.bd-banner', { style: { top: '6%',
        width: `${(Number(b.markW ?? 26) / S.w) * 100}%` } });
      bn.innerHTML = pennantSvg(b.ink || t.cover.ink, b.gold || t.cover.gold);
      p.append(tag(bn, 'banner'));
    }
    if (!isOff(t, 'back', 'blurb')) {
      p.append(tag(h('div.bd-mid', { style: { top: '46%' } },
        h('div.bd-t3', { style: { color: b.ink || t.cover.ink } },
          String(b.blurb || 'نبذةُ ظهر الكتاب — تُكتب هنا.').slice(0, 160))), 'blurb'));
    }
    if (!isOff(t, 'back', 'foot')) {
      p.append(tag(h('div.bd-foot', { style: { color: b.ink || t.cover.ink } },
        h('span', 'الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'),
        b.isbn ? h('span', { dir: 'ltr' }, String(b.isbn)) : null), 'foot'));
    }
    p.append(...deco('back'));
    return p;
  }

  const MAKE = { cover: miniCover, front: miniBasmala, colophon: miniColophon,
                 divider: miniDivider, inner: miniInner, inner2: miniInner,
                 back: miniBack };

  // ـــ المحطّاتُ الخمس: تُقلَّب كما يُقلَّب الكتابُ، صفحةً صفحةً
  //   كبيرةً تُحرَّر، لا مصغَّراتٍ لا تُبصَر (ملاحظتا ٣٧٧ و٣٩٢)
  //
  //   والكتابُ عربيٌّ يُفتَح من اليمين: الصفحةُ اليمنى أوّلُ الورقة،
  //   واليسرى التي بعدها.
  const STATIONS = [
    { label: 'الغلاف', pages: ['cover'] },
    { label: 'ما بعد الغلاف — صفحتان مفتوحتان', pages: ['front', 'colophon'] },
    { label: 'صفحةُ عنوان الخطبة', pages: ['divider'] },
    { label: 'صفحتان من داخل الكتاب', pages: ['inner', 'inner2'] },
    { label: 'ظهرُ الكتاب', pages: ['back'] }
  ];
  let station = 0;
  const stationOf = k => Math.max(0, STATIONS.findIndex(x => x.pages.includes(k)));

  function goStation(i) {
    station = Math.max(0, Math.min(STATIONS.length - 1, i));
    const pages = STATIONS[station].pages;
    if (!pages.includes(page)) page = pages[0];
    drawAll();
  }

  // ـــ الضغطُ والسحبُ على الصفحة نفسِها (ملاحظة ٤٤٣)
  function bindSelect(sheet, key) {
    sheet.addEventListener('pointerdown', ev => {
      const el = ev.target.closest('.bd-obj');
      if (!el || !sheet.contains(el)) return;
      ev.preventDefault();
      if (page !== key) { page = key; }
      objSel = { page: key, ...el.__sel };
      const tg = selTarget(objSel);
      // التحديدُ يُرى فورًا بلا إعادةِ بناءٍ تقطع السحب
      sheet.querySelectorAll('.bd-obj.sel').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      drawProps();
      if (!tg || !tg.move) return;
      const box = sheet.getBoundingClientRect();
      const rtl = getComputedStyle(sheet).direction === 'rtl' ? -1 : 1;
      const x0 = ev.clientX, y0 = ev.clientY;
      const sx = tg.move === 'xy' ? Number(tg.obj.x ?? 0) : 0;
      const sy = tg.move === 'xy' ? Number(tg.obj.y ?? 0) : tg.get();
      el.setPointerCapture?.(ev.pointerId);
      const onMove = e2 => {
        const dy = ((e2.clientY - y0) / box.height) * 100;
        const ny = Math.max(0, Math.min(98, sy + dy));
        if (tg.move === 'xy') {
          const dx = (((e2.clientX - x0) * rtl) / box.width) * 100;
          tg.obj.x = Math.round(Math.max(0, Math.min(98, sx + dx)) * 10) / 10;
          tg.obj.y = Math.round(ny * 10) / 10;
          el.style.insetInlineStart = `${tg.obj.x}%`;
          el.style.top = `${tg.obj.y}%`;
        } else {
          tg.set(ny);
          el.style.top = `${tg.get()}%`;
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        drawAll();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // ـــ بطاقةُ المحدَّد: ما يُعدَّل فيه وما يُحذَف به
  function selCard() {
    if (!objSel) {
      return h('p.small.muted.bd-selhint',
        'اضغطْ أيَّ عنصرٍ على الصفحة — شعارًا أو نصًّا أو رايةً أو إطارًا — '
        + 'يُحدَّد فتَنقلَه بالسحب وتُعدِّلَه وتحذفَه.');
    }
    const tg = selTarget(objSel);
    if (!tg || !tg.obj) { objSel = null; return h('span'); }
    const o = tg.obj;
    const fields = [];
    if (tg.move === 'xy') {
      fields.push(num(o, 'x', 'من اليمين ٪', 0, 98), num(o, 'y', 'من الأعلى ٪', 0, 98));
    }
    if (objSel.type === 'mark' || objSel.type === 'covermark') {
      fields.push(num(o, 'h', 'الارتفاع مم', 3, 200));
      if (objSel.type === 'mark') fields.push(num(o, 'opacity', 'الظهور ٪', 5, 100, 5));
    }
    if (objSel.type === 'text') {
      fields.push(num(o, 'w', 'العرض ٪', 10, 100), num(o, 'size', 'القياس مم', 2, 40),
        h('label.field.sm', 'اللون', colorIn(o.color, v => { o.color = v; })));
    }
    if (objSel.type === 'shape') {
      fields.push(num(o, 'w', 'العرض ٪', 1, 100),
        o.kind === 'line' ? num(o, 'thick', 'السُّمك مم', 0.2, 10, 0.1)
          : num(o, 'h', 'الارتفاع ٪', 1, 100),
        h('label.field.sm', 'اللون', colorIn(o.color, v => { o.color = v; })));
    }
    if (objSel.type === 'banner' && objSel.page === 'cover') {
      fields.push(num(t.cover, 'bannerW', 'عرضُها مم', 0, 60),
        num(t.cover, 'bannerTop', 'نزولُها مم', 0, 80));
    }
    if (objSel.type === 'wm' && o.src) {
      fields.push(num(o, 'size', 'قياسُها ٪', 10, 100), num(o, 'opacity', 'ظهورُها ٪', 1, 60));
    }
    if (objSel.type === 'band') {
      fields.push(num(o, 'h', 'ارتفاعُه مم', 1, 60),
        h('label.field.sm', 'لونُه', colorIn(o.color, v => { o.color = v; })));
    }
    const dup = (objSel.type === 'text' || objSel.type === 'shape' || objSel.type === 'mark'
      || objSel.type === 'covermark') && tg.arr
      ? h('button.btn.xs', { type: 'button', title: 'نسخةٌ منه',
          onclick: () => {
            tg.arr.splice(objSel.i + 1, 0, { ...o, y: (o.y ?? 0) + 4 });
            objSel = { ...objSel, i: objSel.i + 1 }; drawAll();
          } }, '⧉ نسخة')
      : null;
    const del = (tg.arr || tg.off)
      ? h('button.btn.xs.danger', { type: 'button',
          onclick: () => {
            if (tg.arr) tg.arr.splice(objSel.i, 1); else tg.off();
            objSel = null; drawAll();
          } }, '🗑 احذفْه')
      : null;
    const layer = tg.arr
      ? h('div.row', { style: { gap: '4px' } },
          h('button.btn.xs.ghost', { type: 'button', title: 'إلى الأمام',
            onclick: () => { move(tg.arr, objSel.i, 1); objSel = null; } }, '▲'),
          h('button.btn.xs.ghost', { type: 'button', title: 'إلى الخلف',
            onclick: () => { move(tg.arr, objSel.i, -1); objSel = null; } }, '▼'))
      : null;
    const body = objSel.type === 'text'
      ? textIn(o.text, v => { o.text = v; }, { rows: 2, label: 'النص' }) : null;
    return h('div.card.stack.bd-sel',
      h('div.row.between.wrap',
        h('b', `المحدَّد: ${selName(objSel)} — ${PAGE_LABEL[objSel.page] || ''}`),
        h('button.btn.xs.ghost', { type: 'button',
          onclick: () => { objSel = null; drawAll(); } }, 'إلغاءُ التحديد')),
      body,
      fields.length ? h('div.row.wrap', { style: { gap: '6px', alignItems: 'end' } }, fields)
        : h('p.small.muted', 'هذا العنصرُ ثابتُ الموضع: يُحدَّد ويُرفَع ويُعاد من أدواته.'),
      h('div.row.wrap', { style: { gap: '6px' } }, dup, layer, del));
  }

  function drawStage() {
    const S = SH();
    const st = STATIONS[station];
    fill(stage,
      // شريطُ المحطّات: يُرى الموضعُ ويُقفَز إليه
      h('div.bd-steps',
        ...STATIONS.map((x, i) => {
          const b = h('button.bd-step' + (i === station ? '.on' : ''), { type: 'button',
            'aria-current': i === station ? 'step' : null,
            title: x.label }, `${AR(i + 1)}`);
          b.onclick = () => goStation(i);
          return b;
        })),
      h('div.row.between.wrap.bd-nav',
        h('button.btn.sm.ghost', { type: 'button', disabled: station === 0 || null,
          onclick: () => goStation(station - 1) }, '→ السابقة'),
        h('b.bd-station', st.label),
        h('button.btn.sm.ghost', { type: 'button',
          disabled: station === STATIONS.length - 1 || null,
          onclick: () => goStation(station + 1) }, 'التالية ←')),
      h('div.bd-spread' + (st.pages.length > 1 ? '.two' : ''),
        ...st.pages.map(k => {
          const box = h('div.bd-sheet' + (page === k ? '.on' : ''),
            { style: { aspectRatio: `${S.w} / ${S.h}` } }, MAKE[k]());
          bindSelect(box, k);
          // صفحةٌ تُضغَط لتُعمَل عليها، وعناصرُها تُضغَط لتُحدَّد (ملاحظة ٤٤٣)
          const wrap = h('div.bd-sheet-wrap', { tabindex: '0', role: 'button',
            title: `اعمَلْ على ${PAGE_LABEL[k]}`, 'aria-pressed': String(page === k) },
            box, h('span.small.muted', PAGE_LABEL[k]));
          wrap.addEventListener('click', ev => {
            if (ev.target.closest('.bd-obj')) return;
            if (page === k) { objSel = null; drawProps(); return; }
            page = k; objSel = null; drawAll();
          });
          wrap.addEventListener('keydown', ev => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault(); page = k; objSel = null; drawAll();
          });
          return wrap;
        })),
      h('div.row.between.wrap.bd-savebar',
        h('span.small.muted', 'اضغطْ صفحةً لتعمل عليها، وأدواتُها إلى جانبها.'),
        h('button.btn.sm.primary', { type: 'button',
          onclick: ev => busy(ev.currentTarget, saveTpl) }, '💾 احفظْ هذه الصفحة')));
  }

  // ـــ الحفظُ: من ذيل كلِّ محطةٍ ومن الشريط الأعلى سواء (ملاحظة ٣٧٧)
  async function saveTpl() {
    if (String(name).trim().length < 2) { toast('اكتبْ اسمَ القالب', 'bad'); return; }
    try {
      const id = await db.rpc('save_book_template_by_id', {
        p_id: cur?.id || null, p_name: name.trim(), p_tpl: t,
        p_year: forYear, p_default: isDefault });
      rows = await db.rpc('book_templates_list') || [];
      cur = rows.find(r => r.id === id) || cur;
      if (cur) tplCache.set(cur.id, JSON.parse(JSON.stringify(t)));
      toast('حُفظ القالب.', 'ok');
      drawAll();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // -------------------------------------------------------------------
  // الأدوات — لوحةٌ واحدةٌ لكلِّ الصفحات (ملاحظة ٣٥٥)
  // -------------------------------------------------------------------
  const redraw = () => { drawStage(); };

  const colorIn = (val, set) => {
    const i = h('input', { type: 'color', value: val || '#ffffff', 'aria-label': 'لون' });
    i.oninput = () => { set(i.value); redraw(); };
    return i;
  };
  const rangeIn = (val, min, max, set, unit = '') => {
    const out = h('span.small.muted', `${AR(val)}${unit}`);
    const i = h('input', { type: 'range', min: String(min), max: String(max),
      value: String(val ?? min), 'aria-label': 'مقدار' });
    i.oninput = () => { set(Number(i.value)); out.textContent = `${AR(i.value)}${unit}`; redraw(); };
    return h('div.row', { style: { gap: '8px', alignItems: 'center' } }, i, out);
  };
  const check = (on, label, set) => {
    const i = h('input', { type: 'checkbox', checked: on ? true : null, 'aria-label': label });
    i.onchange = () => { set(i.checked); redraw(); };
    return h('label.check', i, h('span', label));
  };
  const pick = (val, opts, set) => {
    const sel = h('select', { 'aria-label': 'اختيار' },
      opts.map(([v, l]) => h('option', { value: v, selected: val === v }, l)));
    sel.onchange = () => { set(sel.value); redraw(); };
    return sel;
  };
  const num = (m, key, label, min, max, step = 0.5) => {
    const i = h('input', { type: 'number', value: String(m[key] ?? ''), min: String(min),
      max: String(max), step: String(step), 'aria-label': label });
    i.oninput = () => { m[key] = Number(i.value); redraw(); };
    return h('label.field.sm', label, i);
  };
  const textIn = (val, set, { rows: r = 3, label = 'نص' } = {}) => {
    const i = h('textarea', { rows: r, 'aria-label': label }, val || '');
    i.oninput = () => { set(i.value); redraw(); };
    return i;
  };

  // ـــ صورُ الصفحة: تُضاف وتُحرَّك وتُحجَّم وتُرتَّب وتُحذَف
  const imgFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'صورة' });
  let imgTarget = null;
  imgFile.onchange = async () => {
    const f = imgFile.files?.[0]; if (!f || !imgTarget) return;
    try {
      const { prepareMark } = await import('../photo.js');
      imgTarget.push({ src: await prepareMark(f, 1200), x: 40, y: 40, h: 20, opacity: 100 });
      drawAll();
    } catch (e) { toast(e.message, 'bad'); }
    imgFile.value = '';
  };
  const bgFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'صورةُ الخلفية' });
  let bgTarget = null;
  bgFile.onchange = async () => {
    const f = bgFile.files?.[0]; if (!f || !bgTarget) return;
    try {
      const { prepareMark } = await import('../photo.js');
      bgTarget.bg = await prepareMark(f, 1400); drawAll();
    } catch (e) { toast(e.message, 'bad'); }
    bgFile.value = '';
  };

  const move = (arr, i, d) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    drawAll();
  };

  // ـــ خلفيةٌ تملأ الصفحة: صورةٌ أو صفحةُ PDF مصمَّمةٌ خارجًا (٣٩٠)
  const pageFile = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true,
    'aria-label': 'خلفيةُ الصفحة' });
  let pageTarget = null;
  pageFile.onchange = async () => {
    const f = pageFile.files?.[0]; if (!f || !pageTarget) return;
    try {
      const { bgImage } = await import('../pdfview.js');
      const S = SH();
      const out = await bgImage(f, { page: 1, mmWide: S.w, dpi: 300 });
      pageTarget.bg = out.url;
      pageTarget.bgName = f.name;
      drawAll();
    } catch (e) { toast(e.message, 'bad'); }
    pageFile.value = '';
  };

  const wmFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'العلامةُ المائية' });
  let wmTarget = null;
  wmFile.onchange = async () => {
    const f = wmFile.files?.[0]; if (!f || !wmTarget) return;
    try {
      const { prepareMark } = await import('../photo.js');
      wmTarget.wm = { ...(wmTarget.wm || {}), src: await prepareMark(f, 1200) };
      drawAll();
    } catch (e) { toast(e.message, 'bad'); }
    wmFile.value = '';
  };

  // ـــ ما رُفع من عناصر الصفحة: يُعاد بضغطة (ملاحظة ٤٥٣)
  function restorePanel(key) {
    const list = (HIDEABLE[key] || []).filter(([k]) => isOff(t, key, k));
    return h('fieldset.stack', h('legend', 'العناصرُ المرفوعة'),
      list.length
        ? h('div.row.wrap', { style: { gap: '6px' } },
            list.map(([k, label]) => {
              const b = h('button.btn.xs', { type: 'button' }, `↩ ${label}`);
              b.onclick = () => { setOff(t, key, k, false); objSel = null; drawAll(); };
              return b;
            }))
        : h('p.small.muted', 'لم يُرفَع من هذه الصفحة شيء.'),
      h('p.small.muted', 'كلُّ عنصرٍ على الصفحة يُضغَط فيُحدَّد ثم يُحذَف من بطاقته، '
        + 'ويعود من هنا متى شئت.'));
  }

  // ـــ خطُّ الصفحة وخطُّ القالب (ملاحظة ٤٥٤)
  function fontPanel(key) {
    const s2 = slotOf(t, key);
    const all = h('select', { 'aria-label': 'خط القالب' },
      BOOK_FONTS.map(([v, n]) => h('option', { value: v, selected: (t.font || '') === v }, n)));
    all.onchange = () => { t.font = all.value; redraw(); };
    const one = h('select', { 'aria-label': 'خط هذه الصفحة' },
      h('option', { value: '', selected: !s2.font }, 'كخطِّ القالب'),
      BOOK_FONTS.filter(([v]) => v).map(([v, n]) =>
        h('option', { value: v, selected: (s2.font || '') === v }, n)));
    one.onchange = () => { s2.font = one.value; redraw(); };
    return h('fieldset.stack', h('legend', 'الخطّ'),
      h('div.uni-grid',
        h('label.field', 'خطُّ القالب كلِّه', all),
        h('label.field', `خطُّ ${PAGE_LABEL[key] || 'الصفحة'}`, one)),
      h('p.small.muted', 'الخطوطُ من خطوط المنصة والطباعة، فلا يختلف المعروضُ عن المطبوع. '
        + 'وحجمُ متن الخطبة يتبع لغتَها.'));
  }

  function pagePanel(key) {
    const s2 = slotOf(t, key);
    return h('div.stack',
      fontPanel(key),
      restorePanel(key),
      h('fieldset.stack', h('legend', 'خلفيةٌ تملأ الصفحة'),
        h('p.small.muted', 'ارفعْ تصميمًا خارجيًّا — صورةً أو ملفَّ PDF — فيُرسَم بدقّة '
          + 'الطباعة أرضيةً للصفحة، وما فوقه من نصوصٍ وشعاراتٍ يبقى.'),
        h('div.row.wrap', { style: { gap: '6px' } },
          h('button.btn.xs', { type: 'button',
            onclick: () => { pageTarget = s2; pageFile.click(); } }, '⤒ ارفعْ خلفية'),
          h('button.btn.xs.ghost', { type: 'button',
            onclick: () => { s2.bg = null; s2.bgName = null; drawAll(); } }, 'بلا خلفية')),
        s2.bg ? h('p.small.muted', `الحالية: ${s2.bgName || 'صورة'}`) : null,
        s2.bg ? h('label.field', 'ملءُ الصفحة',
          pick(s2.bgFit || 'cover', [['cover', 'تملأ ولو قُصَّت'], ['contain', 'تظهر كاملةً']],
            v => { s2.bgFit = v; })) : null,
        s2.bg ? h('label.field', 'شدّةُ ظهورها',
          rangeIn(s2.bgFade ?? 100, 5, 100, v => { s2.bgFade = v; }, '٪')) : null),

      h('fieldset.stack', h('legend', 'الشريط'),
        check(s2.band?.on, 'شريطٌ على عرض الصفحة', v => { slotOf(t, key).band.on = v; }),
        h('div.row.wrap', { style: { gap: '6px', alignItems: 'end' } },
          num(s2.band, 'h', 'ارتفاعُه مم', 1, 60),
          h('label.field.sm', 'لونُه', colorIn(s2.band?.color, v => { s2.band.color = v; })),
          num(s2.band, 'opacity', 'ظهورُه ٪', 5, 100, 5)),
        check(s2.band?.top, 'في الرأس لا في الذيل', v => { slotOf(t, key).band.top = v; })),

      h('fieldset.stack', h('legend', 'العلامةُ المائية'),
        h('div.row.wrap', { style: { gap: '6px' } },
          h('button.btn.xs', { type: 'button',
            onclick: () => { wmTarget = s2; wmFile.click(); } }, '⤒ ارفعْ علامة'),
          h('button.btn.xs.ghost', { type: 'button',
            onclick: () => { s2.wm = { src: null, size: 50, opacity: 8 }; drawAll(); } },
            'بلا علامة')),
        s2.wm?.src ? h('div.row.wrap', { style: { gap: '6px', alignItems: 'end' } },
          num(s2.wm, 'size', 'قياسُها ٪', 10, 100),
          num(s2.wm, 'opacity', 'ظهورُها ٪', 1, 60)) : null));
  }

  function shapesPanel(key) {
    const s2 = slotOf(t, key);
    const add2 = kind => {
      s2.shapes.push({ kind, x: 20, y: 40, w: 60, h: kind === 'line' ? 1 : 10,
        color: t.cover.gold, opacity: 100, thick: 0.6 });
      drawAll();
    };
    return h('div.stack',
      h('div.row.wrap', { style: { gap: '6px' } },
        h('button.btn.xs', { type: 'button', onclick: () => add2('rect') }, '▭ مستطيل'),
        h('button.btn.xs', { type: 'button', onclick: () => add2('circle') }, '◯ دائرة'),
        h('button.btn.xs', { type: 'button', onclick: () => add2('line') }, '— خطّ'),
        h('button.btn.xs', { type: 'button', onclick: () => add2('frame') }, '▢ إطار')),
      ...(s2.shapes.length ? s2.shapes.map((sh, i) =>
        h('div.stack.tx-row',
          h('div.row.wrap', { style: { gap: '6px' } },
            h('b.small', { style: { minWidth: '52px' } },
              ({ rect: 'مستطيل', circle: 'دائرة', line: 'خطّ', frame: 'إطار' })[sh.kind] || 'شكل'),
            num(sh, 'x', 'من اليمين ٪', 0, 98),
            num(sh, 'y', 'من الأعلى ٪', 0, 98),
            num(sh, 'w', 'العرض ٪', 1, 100),
            sh.kind === 'line' ? num(sh, 'thick', 'السُّمك مم', 0.2, 10, 0.1)
              : num(sh, 'h', 'الارتفاع ٪', 1, 100),
            num(sh, 'opacity', 'الظهور ٪', 5, 100, 5),
            h('label.field.sm', 'اللون', colorIn(sh.color, v => { sh.color = v; }))),
          h('div.row.between.wrap',
            h('span.small.muted', 'الطبقةُ تُرفَع وتُخفَض بالسهمين'),
            h('div.row', { style: { gap: '4px' } },
              h('button.btn.xs.ghost', { type: 'button', title: 'إلى الأمام',
                onclick: () => move(s2.shapes, i, 1) }, '▲'),
              h('button.btn.xs.ghost', { type: 'button', title: 'إلى الخلف',
                onclick: () => move(s2.shapes, i, -1) }, '▼'),
              h('button.btn.xs', { type: 'button', title: 'نسخةٌ منه',
                onclick: () => { s2.shapes.splice(i + 1, 0, { ...sh, y: (sh.y ?? 0) + 4 }); drawAll(); } }, '⧉'),
              h('button.btn.xs.danger', { type: 'button',
                onclick: () => { s2.shapes.splice(i, 1); drawAll(); } }, 'احذفْه')))))
        : [h('p.small.muted', 'لا أشكالَ على هذه الصفحة.')]));
  }

  function imagesPanel(key) {
    const s = slotOf(t, key);
    const isCover = key === 'cover';
    return h('fieldset.stack', h('legend', `صورُ ${PAGE_LABEL[key]}`),
      h('div.row.wrap', { style: { gap: '6px' } },
        h('button.btn.xs', { type: 'button',
          onclick: () => { imgTarget = s.marks; imgFile.click(); } }, '＋ أضِفْ صورة'),
        isCover
          ? h('button.btn.xs.ghost', { type: 'button', onclick: () => {
              t.cover.marks = BOOK_MARKS.map(m => ({ ...m })); drawAll();
            } }, 'أعِدِ الشعاراتِ الثلاثة')
          : null),
      ...(s.marks.length ? s.marks.map((m, i) =>
        h('div.row.between.wrap.mark-row',
          h('img.mark-thumb', { src: m.src, alt: '' }),
          h('div.row.wrap', { style: { gap: '6px' } },
            num(m, 'x', 'من اليمين ٪', 0, 98),
            num(m, 'y', 'من الأعلى ٪', 0, 98),
            num(m, 'h', 'الارتفاع مم', 3, 200),
            num(m, 'opacity', 'الظهور ٪', 5, 100, 5)),
          h('div.row', { style: { gap: '4px' } },
            h('button.btn.xs.ghost', { type: 'button', title: 'إلى الأمام',
              onclick: () => move(s.marks, i, 1) }, '▲'),
            h('button.btn.xs.ghost', { type: 'button', title: 'إلى الخلف',
              onclick: () => move(s.marks, i, -1) }, '▼'),
            h('button.btn.xs.danger', { type: 'button',
              onclick: () => { s.marks.splice(i, 1); drawAll(); } }, 'احذفْها'))))
        : [h('p.small.muted', 'لا صورَ على هذه الصفحة.')]));
  }

  function textsPanel(key) {
    const s = slotOf(t, key);
    return h('fieldset.stack', h('legend', `نصوصُ ${PAGE_LABEL[key]}`),
      h('div.row.wrap', { style: { gap: '6px' } },
        h('button.btn.xs', { type: 'button', onclick: () => {
          s.texts.push({ text: 'نصٌّ جديد', x: 10, y: 30, w: 80, size: 5,
            color: t.cover.ink, align: 'center', bold: false });
          drawAll();
        } }, '＋ أضِفْ نصًّا')),
      ...(s.texts.length ? s.texts.map((x, i) =>
        h('div.stack.tx-row',
          textIn(x.text, v => { x.text = v; }, { rows: 2, label: 'النص' }),
          h('div.row.wrap', { style: { gap: '6px' } },
            num(x, 'x', 'من اليمين ٪', 0, 98),
            num(x, 'y', 'من الأعلى ٪', 0, 98),
            num(x, 'w', 'العرض ٪', 10, 100),
            num(x, 'size', 'القياس مم', 2, 40),
            h('label.field.sm', 'اللون', colorIn(x.color, v => { x.color = v; })),
            h('label.field.sm', 'المحاذاة',
              pick(x.align || 'center', [['start', 'إلى اليمين'], ['center', 'وسط'],
                ['end', 'إلى اليسار']], v => { x.align = v; }))),
          h('div.row.between.wrap',
            check(x.bold, 'عريض', v => { x.bold = v; }),
            h('div.row', { style: { gap: '4px' } },
              h('button.btn.xs.ghost', { type: 'button', title: 'إلى الأمام',
                onclick: () => move(s.texts, i, 1) }, '▲'),
              h('button.btn.xs.ghost', { type: 'button', title: 'إلى الخلف',
                onclick: () => move(s.texts, i, -1) }, '▼'),
              h('button.btn.xs.danger', { type: 'button',
                onclick: () => { s.texts.splice(i, 1); drawAll(); } }, 'احذفْه')))))
        : [h('p.small.muted', 'لا نصوصَ حرّةً على هذه الصفحة.')]));
  }

  // ـــ خصائصُ كلِّ صفحةٍ على حِدَة
  const PAGE_PROPS = {
    cover: () => h('div.stack',
      h('div.grid-3',
        h('label.field', 'لونُ الورق', colorIn(t.cover.paper, v => { t.cover.paper = v; })),
        h('label.field', 'لونُ العنوان', colorIn(t.cover.ink, v => { t.cover.ink = v; })),
        h('label.field', 'اللونُ الذهبي', colorIn(t.cover.gold, v => { t.cover.gold = v; }))),
      check(t.cover.pattern, 'نقشٌ باهتٌ خلفَ الغلاف', v => { t.cover.pattern = v; }),
      check(t.cover.foot !== false, 'سطرا الهيئة والجامعة في الذيل', v => { t.cover.foot = v; }),
      h('label.field', 'عرضُ الراية (صفرٌ يُخفيها)',
        rangeIn(t.cover.bannerW ?? 30, 0, 60, v => { t.cover.bannerW = v; }, ' مم')),
      h('label.field', 'نزولُ الراية عن الرأس',
        rangeIn(t.cover.bannerTop ?? 26, 0, 80, v => { t.cover.bannerTop = v; }, ' مم')),
      h('label.field', 'موضعُ كتلة العنوان',
        rangeIn(t.cover.titleY ?? 52, 20, 80, v => { t.cover.titleY = v; }, '٪')),
      h('fieldset.stack', h('legend', 'صورةُ ذيل الغلاف'),
        h('div.row.wrap', { style: { gap: '6px' } },
          h('button.btn.xs', { type: 'button',
            onclick: () => { bgTarget = t.cover; bgFile.click(); } }, '⤒ ارفعْ صورة'),
          h('button.btn.xs.ghost', { type: 'button',
            onclick: () => { t.cover.bg = null; drawAll(); } }, 'بلا صورة'),
          ...COVER_BGS.map(([src, label]) => h('button.btn.xs'
            + (t.cover.bg === src ? '.primary' : ''),
            { type: 'button', onclick: () => { t.cover.bg = src; drawAll(); } }, label))),
        h('label.field', 'شدّةُ ظهورها',
          rangeIn(t.cover.fade ?? 22, 5, 100, v => { t.cover.fade = v; }, '٪')))),

    front: () => h('div.stack',
      h('p.small.muted', 'صفحةُ البسملة تأخذ ورقَ الصفحات الداخلية. '
        + 'والبسملةُ صورةُ الهيئة لا تُبدَّل — وما يُزاد عليها صورٌ ونصوصٌ حرّة.'),
      h('div.grid-2',
        h('label.field', 'لونُ الورق', colorIn(t.inner.paper, v => { t.inner.paper = v; })),
        h('label.field', 'لونُ الحبر', colorIn(t.inner.ink, v => { t.inner.ink = v; })))),

    colophon: () => h('div.stack',
      h('p.small.muted', 'صفحةُ الحقوق: تحمل اسمَ المجمَّع وجهتَه ورمزَ التحقُّق. '
        + 'ونصُّ الحقوق يُكتب هنا، فإن تُرك خرج النصُّ المعتاد.'),
      h('label.field', 'نصُّ الحقوق',
        textIn(t.colophon?.rights || '', v => { slotOf(t, 'colophon').rights = v; },
          { rows: 3, label: 'نصُّ الحقوق' })),
      h('div.grid-2',
        h('label.field', 'لونُ الورق', colorIn(t.inner.paper, v => { t.inner.paper = v; })),
        h('label.field', 'لونُ الحبر', colorIn(t.inner.ink, v => { t.inner.ink = v; })))),

    divider: () => h('div.stack',
      h('div.grid-2',
        h('label.field', 'لونُ الورق', colorIn(t.divider.paper, v => { t.divider.paper = v; })),
        h('label.field', 'لونُ الخطّ', colorIn(t.divider.ink, v => { t.divider.ink = v; }))),
      check(t.divider.banner, 'الرايةُ المزخرفة', v => { t.divider.banner = v; }),
      h('label.field', 'عرضُ الراية',
        rangeIn(t.divider.bannerW ?? 34, 0, 70, v => { t.divider.bannerW = v; }, ' مم')),
      check(t.divider.stamp !== false, 'كتلةُ التاريخ في الزاوية العليا',
        v => { t.divider.stamp = v; }),
      check(t.divider.ghost, 'صورةٌ شبحٌ في الزاوية السفلى', v => { t.divider.ghost = v; }),
      h('label.field', 'موضعُ كتلة العنوان',
        rangeIn(t.divider.midY ?? 62, 30, 80, v => { t.divider.midY = v; }, '٪'))),

    inner: () => h('div.stack',
      h('div.grid-3',
        h('label.field', 'لونُ الورق', colorIn(t.inner.paper, v => { t.inner.paper = v; })),
        h('label.field', 'لونُ الحبر', colorIn(t.inner.ink, v => { t.inner.ink = v; })),
        h('label.field', 'لونُ الحلية', colorIn(t.inner.gold, v => { t.inner.gold = v; }))),
      check(t.inner.head, 'كليشةٌ في رأس الصفحة (اسمُ المجمَّع وعامُه)',
        v => { t.inner.head = v; }),
      check(t.inner.band, 'شريطُ البسملةِ في صدر كلِّ خطبة', v => { t.inner.band = v; }),
      check(t.inner.ornament, 'حليةٌ هندسيةٌ في الذيل', v => { t.inner.ornament = v; })),

    back: () => h('div.stack',
      h('p.small.muted', 'ظهرُ الكتاب آخرُ صفحاته: بلا ترقيمٍ ولا كليشة.'),
      check(t.back.on !== false, 'أدرِجْ ظهرَ الكتاب في المجمَّع', v => { t.back.on = v; }),
      h('div.grid-3',
        h('label.field', 'لونُ الورق', colorIn(t.back.paper, v => { t.back.paper = v; })),
        h('label.field', 'لونُ الخطّ', colorIn(t.back.ink, v => { t.back.ink = v; })),
        h('label.field', 'اللونُ الذهبي', colorIn(t.back.gold, v => { t.back.gold = v; }))),
      check(t.back.pattern, 'نقشٌ باهتٌ خلفَه', v => { t.back.pattern = v; }),
      check(t.back.mark !== false, 'الرايةُ في رأسه', v => { t.back.mark = v; }),
      h('label.field', 'عرضُ الراية',
        rangeIn(t.back.markW ?? 26, 0, 60, v => { t.back.markW = v; }, ' مم')),
      check(t.back.foot !== false, 'سطرُ الهيئة في الذيل', v => { t.back.foot = v; }),
      h('label.field', 'نبذةُ الظهر',
        textIn(t.back.blurb || '', v => { t.back.blurb = v; }, { rows: 4, label: 'النبذة' })),
      h('label.field', 'الترقيمُ الدولي (ISBN)', (() => {
        const i = h('input', { value: t.back.isbn || '', dir: 'ltr',
          placeholder: '978-…', 'aria-label': 'ISBN' });
        i.oninput = () => { t.back.isbn = i.value; redraw(); };
        return i;
      })()),
      h('fieldset.stack', h('legend', 'صورةُ الظهر'),
        h('div.row.wrap', { style: { gap: '6px' } },
          h('button.btn.xs', { type: 'button',
            onclick: () => { bgTarget = t.back; bgFile.click(); } }, '⤒ ارفعْ صورة'),
          h('button.btn.xs.ghost', { type: 'button',
            onclick: () => { t.back.bg = null; drawAll(); } }, 'بلا صورة'),
          ...COVER_BGS.map(([src, label]) => h('button.btn.xs'
            + (t.back.bg === src ? '.primary' : ''),
            { type: 'button', onclick: () => { t.back.bg = src; drawAll(); } }, label))),
        h('label.field', 'شدّةُ ظهورها',
          rangeIn(t.back.fade ?? 16, 5, 100, v => { t.back.fade = v; }, '٪'))))
  };

  // ـــ خياراتُ المصمِّم في إطارٍ واحدٍ ثابتِ الأبعاد، قائمةً قائمة
  //   (ملاحظة ٤١٠). وعرضُ الصفحات على حاله.
  const PROP_TABS = () => [
    { key: 'page', icon: '▣', label: PAGE_LABEL[page],
      hint: 'خصائصُ هذه الصفحةِ وحدَها',
      make: () => (PAGE_PROPS[SLOT_OF(page)] || PAGE_PROPS.cover)() },
    { key: 'bg', icon: '🏞', label: 'الخطُّ والخلفية',
      hint: 'خطُّ الصفحة، وما رُفع منها، وخلفيتُها وشريطُها',
      make: () => pagePanel(SLOT_OF(page)) },
    { key: 'img', icon: '🖼', label: 'الصور', hint: 'شعاراتٌ وصورٌ على الصفحة',
      make: () => imagesPanel(SLOT_OF(page)) },
    { key: 'shape', icon: '◇', label: 'الأشكال', hint: 'مستطيلٌ ودائرةٌ وخطٌّ وإطار',
      make: () => shapesPanel(SLOT_OF(page)) },
    { key: 'text', icon: 'T', label: 'النصوص', hint: 'نصوصٌ حرّةٌ تُكتب وتُنسَّق',
      make: () => textsPanel(SLOT_OF(page)) },
    { key: 'num', icon: '№', label: 'ترقيمُ الصفحات', hint: 'شكلُ الرقم وبدايةُ العدّ',
      make: () => h('div.stack',
        check(t.inner.foot, 'اطبعْ أرقامَ الصفحات', v => { t.inner.foot = v; }),
        h('label.field', 'شكلُ الرقم',
          pick(t.inner.pageno || 'circle', [['circle', 'في دائرة'], ['plain', 'سطرٌ مجرَّد'],
            ['ornament', 'بين خطَّين']], v => { t.inner.pageno = v; })),
        num(t.inner, 'numStart', 'يبدأ العدُّ من', 1, 500, 1),
        h('p.small.muted', 'الغلافُ والبسملةُ والحقوقُ وظهرُ الكتاب بلا رقم، '
          + 'وصفحةُ العنوان تُعَدُّ ولا يُطبع رقمُها.')) },
    { key: 'all', icon: '▦', label: 'عامٌّ للقالب كلِّه', hint: 'هوامشُ الكتاب',
      make: () => {
        const m = t.margins || (t.margins = { top: 22, bottom: 18, inner: 22, outer: 16 });
        return h('div.stack',
          h('div.uni-grid',
            num(m, 'top', 'هامشُ الرأس مم', 5, 60),
            num(m, 'bottom', 'هامشُ الذيل مم', 5, 60),
            num(m, 'inner', 'الهامشُ الداخلي مم', 5, 60),
            num(m, 'outer', 'الهامشُ الخارجي مم', 5, 60)),
          h('p.small.muted', 'الهامشُ الداخليُّ أوسعُ فالخيطُ يأكل منه عند التجليد.'));
      } }
  ];

  let uni = null;
  let uniKey = 'page';
  function drawProps() {
    const tabs = PROP_TABS();
    // العناوينُ تتبع الصفحةَ المحدَّدة، فيُعاد بناءُ الشريط ويبقى
    //   المفتوحُ مفتوحًا والإطارُ بحجمه (ملاحظة ٤١٠)
    if (uni) uniKey = uni.active || uniKey;
    uni = unifiedPanel({ stage: null, tabs,
      onTab: k => { uniKey = k; } });
    fill(props, selCard(), uni.el, imgFile, bgFile, pageFile, wmFile);
    if (tabs.some(x => x.key === uniKey)) uni.show(uniKey);
  }

  // -------------------------------------------------------------------
  // الشريطُ الأعلى: القالبُ واسمُه وحفظُه
  // -------------------------------------------------------------------
  function drawBar() {
    const sel = h('select', { 'aria-label': 'القالب' },
      rows.map(r => h('option', { value: r.id, selected: cur?.id === r.id },
        `${r.name}${r.is_default ? ' ★' : ''}${r.h_year ? ` — ${ARY(r.h_year)}هـ` : ''}`)));
    sel.onchange = () => busy(sel, async () => {
      const r = rows.find(x => x.id === sel.value);
      if (!r) return;
      cur = r; t = merge(await tplOf(r.id)); name = r.name;
      forYear = r.h_year || null; isDefault = !!r.is_default;
      objSel = null;
      drawAll();
    });

    const nameIn = h('input', { value: name, 'aria-label': 'اسمُ القالب' });
    nameIn.oninput = () => { name = nameIn.value; };
    const yearIn = h('input', { type: 'number', min: '1300', max: '1600',
      value: forYear ? String(forYear) : '', placeholder: 'كلُّ الأعوام',
      'aria-label': 'يخصُّ عامًا' });
    yearIn.oninput = () => { forYear = yearIn.value ? Number(yearIn.value) : null; };
    const defIn = h('input', { type: 'checkbox', checked: isDefault ? true : null,
      'aria-label': 'افتراضي' });
    defIn.onchange = () => { isDefault = defIn.checked; };
    const sizeIn = h('select', { 'aria-label': 'المقاس' },
      Object.entries(SIZES).map(([k, v]) =>
        h('option', { value: k, selected: t.size === k }, v.name)));
    sizeIn.onchange = () => { t.size = sizeIn.value; redraw(); };

    const saveBtn = h('button.btn.sm.primary', { type: 'button' }, '💾 احفظِ القالب');
    saveBtn.onclick = () => busy(saveBtn, saveTpl);

    const newBtn = h('button.btn.sm', { type: 'button' }, '＋ قالبٌ جديد');
    newBtn.onclick = () => {
      cur = null; t = merge(null); name = 'قالبٌ جديد';
      forYear = null; isDefault = false; drawAll();
    };
    const copyBtn = h('button.btn.sm.ghost', { type: 'button' }, '⧉ نسخةٌ منه');
    copyBtn.onclick = () => {
      cur = null; name = `${name} — نسخة`; isDefault = false; drawAll();
    };
    const delBtn = (cur && isManager())
      ? h('button.btn.sm.danger', { type: 'button' }, '🗑 احذفْه') : null;
    if (delBtn) delBtn.onclick = () => busy(delBtn, async () => {
      if (!await confirm('حذفُ قالب', `يُحذف «${cur.name}» ولا يُستدرك.`, 'احذفْه', 'danger')) return;
      try {
        await db.rpc('delete_book_template', { p_id: cur.id });
        rows = await db.rpc('book_templates_list') || [];
        cur = rows.find(r => r.is_default) || rows[0] || null;
        t = merge(cur?.tpl); name = cur?.name || 'قالبٌ جديد';
        forYear = cur?.h_year || null; isDefault = !!cur?.is_default;
        toast('حُذف القالب.', 'ok'); drawAll();
      } catch (e) { toast(e.message, 'bad'); }
    });

    fill(bar,
      h('div.row.wrap', { style: { gap: '8px', alignItems: 'end' } },
        h('label.field.sm', 'القالبُ المعروض', sel),
        h('label.field.sm', 'اسمُه', nameIn),
        h('label.field.sm', 'يخصُّ عامًا', yearIn),
        h('label.field.sm', 'المقاس', sizeIn),
        h('label.check', defIn, h('span', 'الافتراضيُّ للأعوام كلِّها'))),
      h('div.row.wrap', { style: { gap: '6px' } }, saveBtn, newBtn, copyBtn, delBtn));
  }

  function drawAll() { drawBar(); drawStage(); drawProps(); }

  if (!rows.length) {
    return h('div',
      h('div.page-head', h('div.grow',
        h('div.eyebrow', 'الأرشيف'), h('h1', 'قوالبُ مجمَّع الخطب السنوي'))),
      emptyState('لا قوالبَ بعد', 'أنشِئْ قالبًا من زرِّ «قالبٌ جديد» في صفحة الأعوام.'));
  }

  drawAll();

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        h('a.btn.sm.ghost', { href: '/app/sermons' }, '← أرشيفُ الخطب')),
      h('div.grow',
        h('div.eyebrow', 'الأرشيف'),
        h('h1', 'قوالبُ مجمَّع الخطب السنوي'),
        h('p.muted', 'تُقلَّب الصفحاتُ كما يُقلَّب الكتاب: الغلافُ، فالصفحتان بعده، فصفحةُ عنوان الخطبة، فصفحتان من المتن، فظهرُ الكتاب. وتُحفَظ كلُّ محطةٍ وحدَها.'))),
    bar,
    h('div.bd-wrap', stage, props));
}

export default render;
