// مصمِّمُ قوالب مجمَّع الخطب السنوي (ملاحظتا ٣٣٩ و٣٥٠)
//
//   على آليّة مصمِّم الشهادات: لوحةٌ تُرى وأدواتٌ تحتها، لا حقولٌ
//   لا يُعرَف أثرُها إلا بعد البناء. وفيه أبوابُ المجمَّع كلُّها:
//   الغلافُ، وصفحةُ عنوان الخطبة، والصفحاتُ الداخلية — كليشتُها
//   وشريطُ بسملتها وترقيمُ صفحاتها وحليةُ ذيلها.
//
//   والقالبُ يخصُّ الأعوامَ كلَّها، إلا أن يُقيَّد بعامٍ بعينه. وثلاثةُ
//   قوالبَ مقترحةٍ تُنشَأ مع المنصة، وكلُّها يُغيَّر ويُزاد عليه.
import { h, fill, toast, busy, dialog, confirm, emptyState } from '../ui.js';
import { db } from '../sb.js';
import { isManager, can } from '../store.js';
import { SIZES, COVER_BGS, BOOK_MARKS, DEFAULT_TPL, BASMALA_IMG, BASMALA_BAND,
         pennantSvg, footOrnamentSvg } from '../sermonbook.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });
const may = () => isManager() || can('arch_design') || can('arch_export');

// القالبُ المحفوظُ قد تنقصه مفاتيحُ المصمِّم، فيُستكمَل بالافتراضي
function merge(saved) {
  const base = DEFAULT_TPL();
  const out = { ...base, ...(saved || {}) };
  for (const k of ['cover', 'divider', 'inner']) {
    out[k] = { ...base[k], ...((saved || {})[k] || {}) };
  }
  if (!Array.isArray(out.cover.marks) || !out.cover.marks.length) {
    out.cover.marks = BOOK_MARKS.map(m => ({ ...m }));
  }
  return out;
}

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
  let tab = 'cover';

  // -------------------------------------------------------------------
  // المعاينة: ثلاثُ صفحاتٍ مصغَّرةٌ بنسبة المقاس نفسِها
  // -------------------------------------------------------------------
  const SH = () => SIZES[t.size] || SIZES.book;

  function miniCover() {
    const S = SH();
    const p = h('div.bd-page', { style: { background: t.cover.paper } });
    if (t.cover.pattern) p.append(h('div.bd-pat', { style: {
      '--g': t.cover.gold } }));
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
    if (t.divider.ghost && t.cover.bg) {
      p.append(h('img.bd-ghost', { src: t.cover.bg, alt: '' }));
    }
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
          style: { color: t.inner.ink, borderColor: t.inner.gold } }, '٧')));
    }
    return p;
  }

  function miniBasmala() {
    const p = h('div.bd-page', { style: { background: t.inner.paper } });
    p.append(h('div.bd-bsm', h('img', { src: BASMALA_IMG, alt: 'البسملة' })));
    return p;
  }

  const PAGES = {
    cover:   ['الغلاف', miniCover],
    divider: ['صفحةُ عنوان الخطبة', miniDivider],
    inner:   ['الصفحةُ الداخلية', miniInner],
    front:   ['صفحةُ البسملة', miniBasmala]
  };

  function drawStage() {
    const S = SH();
    fill(stage,
      h('div.bd-sheets',
        ...Object.entries(PAGES).map(([k, [label, make]]) => {
          const box = h('div.bd-sheet' + (tab === k ? '.on' : ''),
            { style: { aspectRatio: `${S.w} / ${S.h}` } }, make());
          const wrap = h('button.bd-sheet-wrap', { type: 'button',
            title: `اعرِضْ أدواتِ ${label}`,
            onclick: () => { if (PROPS[k]) { tab = k; drawAll(); } } },
            box, h('span.small.muted', label));
          return wrap;
        })));
  }

  // -------------------------------------------------------------------
  // الأدوات
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

  // شعاراتُ الغلاف: تُضاف وتُحرَّك وتُحذَف
  const markFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'ملفُّ الشعار' });
  markFile.onchange = async () => {
    const f = markFile.files?.[0]; if (!f) return;
    try {
      const { prepareMark } = await import('../photo.js');
      t.cover.marks.push({ src: await prepareMark(f, 600), x: 45, y: 6, h: 16 });
      drawAll();
    } catch (e) { toast(e.message, 'bad'); }
    markFile.value = '';
  };
  const bgFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
    'aria-label': 'صورةُ الغلاف' });
  bgFile.onchange = async () => {
    const f = bgFile.files?.[0]; if (!f) return;
    try {
      const { prepareMark } = await import('../photo.js');
      t.cover.bg = await prepareMark(f, 1400); drawAll();
    } catch (e) { toast(e.message, 'bad'); }
    bgFile.value = '';
  };

  const num = (m, key, label, min, max) => {
    const i = h('input', { type: 'number', value: String(m[key]), min: String(min),
      max: String(max), step: '0.5', 'aria-label': label });
    i.oninput = () => { m[key] = Number(i.value); redraw(); };
    return h('label.field.sm', label, i);
  };

  const PROPS = {
    cover: () => h('div.stack',
      h('div.grid-3',
        h('label.field', 'لونُ الورق', colorIn(t.cover.paper, v => { t.cover.paper = v; })),
        h('label.field', 'لونُ العنوان', colorIn(t.cover.ink, v => { t.cover.ink = v; })),
        h('label.field', 'اللونُ الذهبي', colorIn(t.cover.gold, v => { t.cover.gold = v; }))),
      check(t.cover.pattern, 'نقشٌ باهتٌ خلفَ الغلاف', v => { t.cover.pattern = v; }),
      check(t.cover.foot !== false, 'سطرا الهيئة والجامعة في الذيل', v => { t.cover.foot = v; }),
      h('label.field', 'عرضُ الراية (مم — صفرٌ يُخفيها)',
        rangeIn(t.cover.bannerW ?? 30, 0, 60, v => { t.cover.bannerW = v; }, ' مم')),
      h('label.field', 'نزولُ الراية عن الرأس',
        rangeIn(t.cover.bannerTop ?? 26, 0, 80, v => { t.cover.bannerTop = v; }, ' مم')),
      h('label.field', 'موضعُ كتلة العنوان',
        rangeIn(t.cover.titleY ?? 52, 20, 80, v => { t.cover.titleY = v; }, '٪')),
      h('fieldset.stack', h('legend', 'صورةُ ذيل الغلاف'),
        h('div.row.wrap', { style: { gap: '6px' } },
          h('button.btn.xs', { type: 'button', onclick: () => bgFile.click() }, '⤒ ارفعْ صورة'),
          bgFile,
          h('button.btn.xs.ghost', { type: 'button',
            onclick: () => { t.cover.bg = null; drawAll(); } }, 'بلا صورة'),
          ...COVER_BGS.map(([src, label]) => h('button.btn.xs'
            + (t.cover.bg === src ? '.primary' : ''),
            { type: 'button', onclick: () => { t.cover.bg = src; drawAll(); } }, label))),
        h('label.field', 'شدّةُ ظهورها',
          rangeIn(t.cover.fade ?? 22, 5, 100, v => { t.cover.fade = v; }, '٪'))),
      h('fieldset.stack', h('legend', 'الشعارات'),
        h('div.row.wrap', { style: { gap: '6px' } },
          h('button.btn.xs', { type: 'button', onclick: () => markFile.click() }, '＋ شعار'),
          markFile,
          h('button.btn.xs.ghost', { type: 'button', onclick: () => {
            t.cover.marks = BOOK_MARKS.map(m => ({ ...m })); drawAll();
          } }, 'أعِدِ الثلاثةَ الافتراضية')),
        ...(t.cover.marks.length ? t.cover.marks.map((m, i) =>
          h('div.row.between.wrap.mark-row',
            h('img.mark-thumb', { src: m.src, alt: '' }),
            h('div.row.wrap', { style: { gap: '6px' } },
              num(m, 'x', 'من اليمين ٪', 0, 95),
              num(m, 'y', 'من الأعلى ٪', 0, 95),
              num(m, 'h', 'الارتفاع مم', 5, 40)),
            h('button.btn.xs.ghost', { type: 'button',
              onclick: () => { t.cover.marks.splice(i, 1); drawAll(); } }, 'احذفه')))
          : [h('p.small.muted', 'لا شعارات على الغلاف.')]))),

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
      check(t.inner.ornament, 'حليةٌ هندسيةٌ في الذيل', v => { t.inner.ornament = v; }),
      check(t.inner.foot, 'ترقيمُ الصفحات', v => { t.inner.foot = v; }),
      h('label.field', 'شكلُ الرقم',
        pick(t.inner.pageno || 'circle', [['circle', 'في دائرة'], ['plain', 'سطرٌ مجرَّد'],
          ['ornament', 'بين خطَّين']], v => { t.inner.pageno = v; })),
      h('p.small.muted', 'المقدماتُ بلا رقم، والعدُّ يبدأ من متن الخطب، '
        + 'وصفحةُ العنوان تُعَدُّ ولا يُطبع رقمُها.')),

    front: () => h('div.stack',
      h('p.small.muted', 'صفحةُ البسملة وصفحةُ الحقوق تأخذان ورقَ الصفحات الداخلية '
        + 'وحبرَها. والبسملةُ صورةُ الهيئة لا تُبدَّل.'),
      h('div.grid-2',
        h('label.field', 'لونُ الورق', colorIn(t.inner.paper, v => { t.inner.paper = v; })),
        h('label.field', 'لونُ الحبر', colorIn(t.inner.ink, v => { t.inner.ink = v; }))))
  };

  function drawProps() {
    const [label] = PAGES[tab] || PAGES.cover;
    fill(props,
      h('div.tabs', ...Object.entries(PAGES).map(([k, [lbl]]) => {
        const b = h('button.tab', { type: 'button',
          'aria-selected': tab === k ? 'true' : 'false' }, lbl);
        b.onclick = () => { tab = k; drawAll(); };
        return b;
      })),
      h('h3.bd-h', label),
      (PROPS[tab] || PROPS.cover)());
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
    saveBtn.onclick = () => busy(saveBtn, async () => {
      if (String(name).trim().length < 2) return toast('اكتبْ اسمَ القالب', 'bad');
      try {
        const id = await db.rpc('save_book_template_by_id', {
          p_id: cur?.id || null, p_name: name.trim(), p_tpl: t,
          p_year: forYear, p_default: isDefault });
        rows = await db.rpc('book_templates_list') || [];
        cur = rows.find(r => r.id === id) || cur;
        toast('حُفظ القالب.', 'ok');
        drawAll();
      } catch (e) { toast(e.message, 'bad'); }
    });

    const newBtn = h('button.btn.sm', { type: 'button' }, '＋ قالبٌ جديد');
    newBtn.onclick = () => {
      cur = null; t = DEFAULT_TPL(); name = 'قالبٌ جديد';
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
        h('p.muted', 'قالبٌ واحدٌ يحمل المجمَّعَ كلَّه: غلافُه، وصفحةُ عنوان كلِّ خطبة، '
          + 'وكليشتُه الداخلية، وترقيمُ صفحاته، وحليةُ ذيله. '
          + 'يخصُّ الأعوامَ كلَّها إلا أن تُقيِّده بعام.'))),
    bar,
    h('div.bd-wrap', stage, props));
}

export default render;
