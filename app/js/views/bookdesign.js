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
import { SIZES, COVER_BGS, BOOK_MARKS, DEFAULT_TPL, TPL_SLOTS, slotOf,
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

  const wanted = ctx?.query?.get('id') || '';
  let cur = rows.find(r => r.id === wanted) || rows.find(r => r.is_default) || rows[0] || null;
  let t = merge(cur?.tpl);
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
  function deco(key) {
    const S = SH();
    const s = slotOf(t, key);
    const out = [];
    if (s.bg) {
      out.push(h('img.bd-bg', { src: s.bg, alt: '', style: {
        objectFit: s.bgFit === 'contain' ? 'contain' : 'cover',
        opacity: s.bgFade != null ? String(Math.max(0, Math.min(100, s.bgFade)) / 100) : null } }));
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
      out.push(h('div.bd-sh', { style: st }));
    }
    if (s.band && s.band.on) {
      out.push(h('div.bd-band', { style: {
        height: `${((s.band.h ?? 10) / S.h) * 100}%`,
        background: s.band.color || '#174a38',
        opacity: String(Math.max(0, Math.min(100, s.band.opacity ?? 100)) / 100),
        top: s.band.top ? '0' : 'auto', bottom: s.band.top ? 'auto' : '0' } }));
    }
    if (s.wm && s.wm.src) {
      out.push(h('div.bd-wm', h('img', { src: s.wm.src, alt: '', style: {
        width: `${Math.max(10, Math.min(100, s.wm.size ?? 50))}%`,
        opacity: String(Math.max(1, Math.min(60, s.wm.opacity ?? 8)) / 100) } })));
    }
    for (const m of s.marks) {
      if (!m || !m.src) continue;
      out.push(h('img.bd-mk', { src: m.src, alt: '', style: {
        insetInlineStart: `${m.x}%`, top: `${m.y}%`, height: `${(m.h / S.h) * 100}%`,
        opacity: m.opacity != null ? String(Math.max(0, Math.min(100, m.opacity)) / 100) : null } }));
    }
    for (const x of s.texts) {
      if (!x || !String(x.text || '').trim()) continue;
      out.push(h('div.bd-tx', { style: {
        insetInlineStart: `${x.x ?? 10}%`, top: `${x.y ?? 10}%`, width: `${x.w ?? 80}%`,
        fontSize: `${((x.size ?? 4) / S.w) * 100}cqw`, color: x.color || '#174a38',
        textAlign: x.align || 'center', fontWeight: x.bold ? '700' : '400' } },
        String(x.text)));
    }
    return out;
  }

  function miniCover() {
    const S = SH();
    const p = h('div.bd-page', { style: { background: t.cover.paper } });
    if (t.cover.pattern) p.append(h('div.bd-pat', { style: { '--g': t.cover.gold } }));
    if (t.cover.bg) {
      p.append(h('img.bd-cover-bg', { src: t.cover.bg, alt: '',
        style: { opacity: String(Math.max(0, Math.min(100, t.cover.fade)) / 100) } }));
    }
    for (const m of t.cover.marks) {
      p.append(h('img.bd-mk', { src: m.src, alt: '', style: {
        insetInlineStart: `${m.x}%`, top: `${m.y}%`, height: `${(m.h / S.h) * 100}%` } }));
    }
    if (Number(t.cover.bannerW) > 0) {
      const b = h('div.bd-banner', { style: {
        top: `${((t.cover.bannerTop ?? 26) / S.h) * 100}%`,
        width: `${(Number(t.cover.bannerW) / S.w) * 100}%` } });
      b.innerHTML = pennantSvg(t.cover.ink, t.cover.gold);
      p.append(b);
    }
    p.append(h('div.bd-mid', { style: { top: `${t.cover.titleY ?? 52}%` } },
      h('b.bd-t1', { style: { color: t.cover.ink } }, 'مجمَّع الخطب السنوي'),
      h('div.bd-rule', { style: { background: t.cover.gold } }),
      h('div.bd-t2', { style: { color: t.cover.gold } }, 'لخُطب المسجد الحرام المترجمة'),
      h('div.bd-t3', { style: { color: t.cover.gold } }, 'إلى الإنجليزية'),
      h('div.bd-t4', { style: { color: t.cover.ink } }, 'لعام ١٤٤٥هـ')));
    if (t.cover.foot !== false) {
      p.append(h('div.bd-foot', { style: { color: t.cover.ink } },
        h('span', 'الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'),
        h('span', 'مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين — بتنفيذ جامعة أمِّ القرى')));
    }
    p.append(...deco('cover'));
    return p;
  }

  function miniDivider() {
    const S = SH();
    const p = h('div.bd-page', { style: { background: t.divider.paper } });
    if (t.divider.banner && Number(t.divider.bannerW) > 0) {
      const b = h('div.bd-banner', { style: { top: '0',
        width: `${(Number(t.divider.bannerW) / S.w) * 100}%` } });
      b.innerHTML = pennantSvg(t.divider.ink, t.cover.gold);
      p.append(b);
    }
    if (t.divider.ghost && t.cover.bg) p.append(h('img.bd-ghost', { src: t.cover.bg, alt: '' }));
    if (t.divider.stamp !== false) {
      p.append(h('div.bd-stamp', { style: { color: t.divider.ink } },
        h('div', 'خطبـة الجمعة'), h('div', '٧ محرم ١٤٤٤هـ'), h('div', 'الموافق 2022/8/5م')));
    }
    p.append(h('div.bd-mid', { style: { top: `${t.divider.midY ?? 62}%` } },
      h('div.bd-t3', { style: { color: t.divider.ink } }, 'موضـوع الخطبة:'),
      h('b.bd-t1', { style: { color: t.divider.ink } }, 'راحـة البال'),
      h('div.bd-t3', { style: { color: t.divider.ink, marginTop: '4%' } }, 'لفضيـلة الشيـخ'),
      h('b.bd-t2', { style: { color: t.divider.ink } }, 'د. سعود بن إبراهيم الشريم'),
      h('div.bd-rule', { style: { background: t.cover.gold } })));
    p.append(...deco('divider'));
    return p;
  }

  function miniInner() {
    const p = h('div.bd-page', { style: { background: t.inner.paper } });
    if (t.inner.head) {
      p.append(h('div.bd-head', { style: { color: t.inner.gold,
        borderBottom: `1px solid ${t.inner.gold}` } },
        h('span', 'مجمَّع الخطب السنوي'), h('span', 'لعام ١٤٤٥هـ')));
    }
    const win = h('div.bd-win');
    if (t.inner.band) win.append(h('img.bd-band', { src: BASMALA_BAND, alt: '' }));
    win.append(h('div.bd-kh', { style: { color: t.cover.ink } }, '(الخطبةُ الأولى)'));
    for (let i = 0; i < 9; i++) {
      win.append(h('div.bd-line', { style: { background: t.inner.ink,
        width: i % 4 === 3 ? '62%' : '100%' } }));
    }
    p.append(win);
    if (t.inner.ornament) {
      const o = h('div.bd-orn');
      o.innerHTML = footOrnamentSvg(t.inner.gold);
      p.append(o);
    }
    if (t.inner.foot) {
      p.append(h('div.bd-no',
        h('span', { class: `pno ${t.inner.pageno || 'circle'}`,
          style: { color: t.inner.ink, borderColor: t.inner.gold } },
          AR(t.inner.numStart ?? 1))));
    }
    p.append(...deco('inner'));
    return p;
  }

  function miniBasmala() {
    const p = h('div.bd-page', { style: { background: t.inner.paper } });
    p.append(h('div.bd-bsm', h('img', { src: BASMALA_IMG, alt: 'البسملة' })));
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
      h('div.bd-qr', { style: { borderColor: t.inner.ink } }));
    p.append(box);
    p.append(...deco('colophon'));
    return p;
  }

  function miniBack() {
    const S = SH();
    const b = t.back || {};
    const p = h('div.bd-page', { style: { background: b.paper || t.cover.paper } });
    if (b.pattern) p.append(h('div.bd-pat', { style: { '--g': b.gold || t.cover.gold } }));
    if (b.bg) {
      p.append(h('img.bd-cover-bg', { src: b.bg, alt: '',
        style: { opacity: String(Math.max(0, Math.min(100, b.fade ?? 16)) / 100) } }));
    }
    if (b.mark !== false) {
      const bn = h('div.bd-banner', { style: { top: '6%',
        width: `${(Number(b.markW ?? 26) / S.w) * 100}%` } });
      bn.innerHTML = pennantSvg(b.ink || t.cover.ink, b.gold || t.cover.gold);
      p.append(bn);
    }
    p.append(h('div.bd-mid', { style: { top: '46%' } },
      h('div.bd-t3', { style: { color: b.ink || t.cover.ink } },
        String(b.blurb || 'نبذةُ ظهر الكتاب — تُكتب هنا.').slice(0, 160))));
    if (b.foot !== false) {
      p.append(h('div.bd-foot', { style: { color: b.ink || t.cover.ink } },
        h('span', 'الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'),
        b.isbn ? h('span', { dir: 'ltr' }, String(b.isbn)) : null));
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
          return h('button.bd-sheet-wrap', { type: 'button',
            title: `اعمَلْ على ${PAGE_LABEL[k]}`,
            onclick: () => { page = k; drawAll(); } },
            box, h('span.small.muted', PAGE_LABEL[k]));
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

  function pagePanel(key) {
    const s2 = slotOf(t, key);
    return h('div.stack',
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

  function drawProps() {
    const m = t.margins || (t.margins = { top: 22, bottom: 18, inner: 22, outer: 16 });
    fill(props,
      // ـــ الصفحةُ المحدَّدة: شريطٌ يوازي ما في اللوحة
      h('div.bd-pages', ...[...TPL_SLOTS, 'inner2'].map(k => {
        const b = h('button.tab', { type: 'button',
          'aria-selected': page === k ? 'true' : 'false' }, PAGE_LABEL[k]);
        b.onclick = () => { page = k; station = stationOf(k); drawAll(); };
        return b;
      })),

      // ـــ ما يعمُّ القالبَ كلَّه
      h('details.bd-sec', { open: true },
        h('summary', 'عامٌّ للقالب كلِّه'),
        h('div.stack',
          h('div.row.wrap', { style: { gap: '8px', alignItems: 'end' } },
            num(m, 'top', 'هامشُ الرأس مم', 5, 60),
            num(m, 'bottom', 'هامشُ الذيل مم', 5, 60),
            num(m, 'inner', 'الهامشُ الداخلي مم', 5, 60),
            num(m, 'outer', 'الهامشُ الخارجي مم', 5, 60)),
          h('p.small.muted', 'الهامشُ الداخليُّ أوسعُ فالخيطُ يأكل منه عند التجليد.'))),

      // ـــ ترقيمُ الصفحات
      h('details.bd-sec', { open: true },
        h('summary', 'ترقيمُ الصفحات'),
        h('div.stack',
          check(t.inner.foot, 'اطبعْ أرقامَ الصفحات', v => { t.inner.foot = v; }),
          h('label.field', 'شكلُ الرقم',
            pick(t.inner.pageno || 'circle', [['circle', 'في دائرة'], ['plain', 'سطرٌ مجرَّد'],
              ['ornament', 'بين خطَّين']], v => { t.inner.pageno = v; })),
          num(t.inner, 'numStart', 'يبدأ العدُّ من', 1, 500, 1),
          h('p.small.muted', 'الغلافُ والبسملةُ والحقوقُ وظهرُ الكتاب بلا رقم، '
            + 'وصفحةُ العنوان تُعَدُّ ولا يُطبع رقمُها.'))),

      // ـــ ما يخصُّ الصفحةَ المحدَّدة
      h('details.bd-sec', { open: true },
        h('summary', `خصائصُ ${PAGE_LABEL[page]}`),
        (PAGE_PROPS[SLOT_OF(page)] || PAGE_PROPS.cover)()),
      h('details.bd-sec', { open: true },
        h('summary', `خلفيةُ ${PAGE_LABEL[page]} وشريطُها وعلامتُها`),
        pagePanel(SLOT_OF(page))),
      h('details.bd-sec', { open: true },
        h('summary', `صورُ ${PAGE_LABEL[page]}`), imagesPanel(SLOT_OF(page))),
      h('details.bd-sec', { open: true },
        h('summary', `أشكالُ ${PAGE_LABEL[page]}`), shapesPanel(SLOT_OF(page))),
      h('details.bd-sec', { open: true },
        h('summary', `نصوصُ ${PAGE_LABEL[page]}`), textsPanel(SLOT_OF(page))),
      imgFile, bgFile, pageFile, wmFile);
  }

  // -------------------------------------------------------------------
  // الشريطُ الأعلى: القالبُ واسمُه وحفظُه
  // -------------------------------------------------------------------
  function drawBar() {
    const sel = h('select', { 'aria-label': 'القالب' },
      rows.map(r => h('option', { value: r.id, selected: cur?.id === r.id },
        `${r.name}${r.is_default ? ' ★' : ''}${r.h_year ? ` — ${ARY(r.h_year)}هـ` : ''}`)));
    sel.onchange = () => {
      const r = rows.find(x => x.id === sel.value);
      if (!r) return;
      cur = r; t = merge(r.tpl); name = r.name;
      forYear = r.h_year || null; isDefault = !!r.is_default;
      drawAll();
    };

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
