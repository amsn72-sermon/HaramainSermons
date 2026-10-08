// أرشيفُ الخطب السنوي: أعوامٌ وأقسامٌ وأسابيعُ جُمَع (ملاحظة ٣٠٣)
//
//   يُفتح على أيقونات الأعوام، وفي العام أقسامُه، وفي القسم أسابيعُ
//   الجُمَع — في كلِّ أسبوع صفَّان: المسجدُ الحرامُ والمسجدُ النبويّ،
//   وتحت كلٍّ لغاتُه. والغائبُ يبقى صفًّا خاليًا موسومًا، فيُبصَر
//   الناقصُ بالنظر لا بالبحث.
//
//   والمجمَّعُ السنويُّ يُولَّد من هذه الخطب لا يُرفَع جاهزًا (ملاحظة ٣٠٩).
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDate, fmtHijri } from '../ui.js';
import { db, storage } from '../sb.js';
import { MOSQUE, SERMON_TYPES, langName, trLangs, isManager, can } from '../store.js';
import { typeIcon } from '../icons.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });
const MOSQUE_ICON = { makkah: '🕋', madinah: '🕌' };

const mayUpload = () => isManager() || can('arch_upload');
const mayEdit   = () => isManager() || can('arch_edit');
const mayExport = () => isManager() || can('arch_export');
const mayDesign = () => isManager() || can('arch_design') || can('arch_export');
const mayCarry  = () => isManager() || can('arch_carry')  || can('arch_upload');
const mayRefine = () => isManager() || can('arch_refine') || can('arch_edit');

// أيقوناتُ صفِّ الخطبة — على نسق أرشيف أعمال الترجمة (ملاحظة ٣٠٣)
const ICONS = {
  open:  '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
  langs: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  edit:  '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M14 6l4 4"/>',
  // تنقيحُ النصِّ على الكليشة: ورقةٌ وقلم (ملاحظة ٣٣٨)
  pen:   '<path d="M6 3h8l5 5v4"/><path d="M14 3v6h6"/>'
         + '<path d="M11 21H6V3"/><path d="M14.5 20.5 20 15l2 2-5.5 5.5-3 .8z"/>',
  down:  '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/>',
  // تنزيلُ الخطبة: وورد وPDF والملفُّ المرفوع (ملاحظة ٣٣٢)
  word:  '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>'
         + '<path d="M8.5 12l1.4 5 1.6-3.6L13.1 17l1.4-5"/>',
  pdf:   '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M12 11v7m-3-3 3 3 3-3"/>',
  file:  '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 14h6M9 17.5h4"/>',
  audio: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'
};
const ico = name => {
  const sp = document.createElement('span');
  sp.className = 'ico'; sp.setAttribute('aria-hidden', 'true');
  sp.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return sp;
};

// ---------------------------------------------------------------------
// ١) الأعوام
// ---------------------------------------------------------------------
export async function render(ctx) {
  const year = Number(ctx?.params?.year || 0);
  if (year) return yearPage(ctx, year);

  let tiles = [];
  try { tiles = await db.rpc('arch_year_tiles') || []; } catch (e) { tiles = []; }

  // ثلاثُ بطاقاتٍ في الصفّ، تصاعديًّا من اليمين، بأرقام العام (ملاحظتا ٣٢٨ و٣٢٩)
  const grid = h('div.year-grid');
  const draw = () => {
    const rows = [...tiles].sort((a, b) => a.h_year - b.h_year);
    fill(grid, ...(rows.length ? rows.map(t => {
      const pct = Number(t.pct || 0);
      return h('a.year-tile', { href: `/app/sermons/${t.h_year}` },
        h('b.year-no', ARY(t.h_year)),
        h('span.year-h', 'هـ'),
        h('div.year-bar', { title: `اكتملَ ${AR(pct)}٪ من جُمَع العام` },
          h('span', { style: { width: `${Math.max(2, pct)}%` },
            class: pct >= 90 ? 'ok' : pct >= 50 ? 'warn' : 'bad' })),
        h('div.year-stats',
          stat(t.covered, 'جمعة مغطّاة', `من ${AR(t.fridays)}`),
          stat(t.sermons, 'خطبة'),
          stat(t.versions, 'نسخة'),
          stat(t.langs, 'لغة'),
          stat(t.khateebs, 'خطيب'),
          stat(t.gaps, 'جمعة ناقصة', null, Number(t.gaps) ? 'bad' : 'ok')));
    }) : [emptyState('لا أعوام بعد', 'أضِفْ عامًا لتبدأ الأرشفة.')]));
  };
  const stat = (n, label, sub, kind) =>
    h('div.year-stat', { class: kind || '' },
      h('b', AR(n || 0)), h('span', label),
      sub ? h('i.small.muted', sub) : null);
  draw();

  const addYear = async () => {
    const y = h('input', { type: 'number', min: '1300', max: '1600',
      value: String(Math.max(1448, ...tiles.map(t => t.h_year)) + 1), 'aria-label': 'العام الهجري' });
    const res = await dialog({
      title: 'إضافةُ عام',
      body: h('div.stack',
        h('p.small.muted', 'يُنشأ العامُ ومعه قسمُ «الخطب»، وتُحسَب جُمَعُه من تقويمه.'),
        h('label.field', 'العام الهجري', y)),
      buttons: [{ label: 'أضِفْه', kind: 'primary',
        validate: () => (Number(y.value) >= 1300 ? true : 'عامٌ غيرُ صحيح'),
        value: () => Number(y.value) }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('add_arch_year', { p_year: res, p_note: null });
      tiles = await db.rpc('arch_year_tiles') || [];
      draw();
      toast('أُضيف العام.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        mayDesign()
          ? h('a.btn.sm', { href: '/app/book-design',
              title: 'الغلافُ وصفحاتُ العناوين والكليشةُ والترقيم' },
              '🖌 قوالبُ المجمَّع السنوي')
          : null,
        mayUpload()
          ? h('button.btn.sm.primary', { type: 'button', onclick: addYear }, '＋ عام')
          : null),
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'أرشيفُ الخطب'),
        h('p.muted', 'خطبُ الحرمين بأعوامها الهجرية: في كلِّ عامٍ أسابيعُ جُمَعِه، '
          + 'وفي كلِّ جمعةٍ خطبتان بلغاتهما. ومنه يُصدَر المجمَّعُ السنوي.'))),
    grid);
}

// ---------------------------------------------------------------------
// ٢) العام: أقسامُه ثم أسابيعُه
// ---------------------------------------------------------------------
async function yearPage(ctx, year) {
  let sections = [];
  try { sections = await db.rpc('arch_section_tiles', { p_year: year }) || []; } catch { sections = []; }

  const wanted = ctx?.query?.get('s') || '';
  let section = sections.find(s => s.id === wanted) || sections[0] || null;

  const body = h('div.stack');
  const secBar = h('div.sec-bar');

  const drawSecs = () => {
    fill(secBar, ...[
      ...sections.map(s => {
        const b = h('button.sec-tile' + (section && s.id === section.id ? '.on' : ''),
          { type: 'button' },
          h('span.sec-ico', typeIcon(s.icon || 'خطب', { size: 20 })),
          h('b', s.name),
          h('span.small.muted', `${AR(s.sermons)} خطبة · ${AR(s.versions)} نسخة`));
        b.onclick = () => { section = s; drawSecs(); drawWeeks(); };
        return b;
      }),
      mayUpload()
        ? h('button.sec-tile.add', { type: 'button', onclick: addSection },
            h('b', '＋ قسم'), h('span.small.muted', 'يُسمّى بحرّية'))
        : null
    ].filter(Boolean));
  };

  async function addSection() {
    const name = h('input', { placeholder: 'الدروس · الكتب · التوجيهات', 'aria-label': 'اسم القسم' });
    const icon = h('select', { 'aria-label': 'الأيقونة' },
      ['خطب', 'دروس علمية', 'كتب', 'مطويات', 'منشورات', 'إعلانات', 'توجيهات']
        .map(t => h('option', { value: t }, t)));
    const res = await dialog({
      title: `قسمٌ جديدٌ في ${ARY(year)}هـ`,
      body: h('div.stack',
        h('label.field', 'اسم القسم', name),
        h('label.field', 'الأيقونة', icon)),
      buttons: [{ label: 'أضِفْه', kind: 'primary',
        validate: () => (name.value.trim().length > 1 ? true : 'اكتب اسمَ القسم'),
        value: () => ({ name: name.value.trim(), icon: icon.value }) }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('add_arch_section', { p_year: year, p_name: res.name, p_icon: res.icon });
      sections = await db.rpc('arch_section_tiles', { p_year: year }) || [];
      section = sections.find(s => s.name === res.name) || section;
      drawSecs(); drawWeeks();
      toast('أُضيف القسم.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  // -------------------------------------------------------------------
  // الأسابيع
  // -------------------------------------------------------------------
  let weeks = [];
  let occasions = [];
  let onlyShort = false;

  async function loadWeeks() {
    const p = { p_year: year, p_section: section ? section.id : null };
    try {
      [weeks, occasions] = await Promise.all([
        db.rpc('arch_weeks', p).catch(() => []),
        db.rpc('arch_occasions', p).catch(() => [])
      ]);
    } catch { weeks = []; occasions = []; }
  }

  // أيقوناتُ العمل على الخطبة: العرضُ والتعديلُ والتنزيلُ والحذف
  //   (ملاحظتا ٣٣٠ و٣٣٢ — والتنزيلُ يُنزِّل فعلًا لا يفتح نافذةَ عرض)
  const sermonActs = (s, mosque, friday) => {
    const dl = async (fn, btn) => {
      try { await busy(btn, async () => { await fn(); }); }
      catch (e) { toast(e.message, 'bad'); }
    };
    const act = (name, title, run, cls = '') =>
      h('button.icon-btn' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title,
        onclick: ev => run(ev.currentTarget) }, ico(name));
    return h('span.sm-acts',
      act('open', 'اعرضِ الخطبةَ ونسخَها', () => openSermon(s.id)),
      mayEdit() ? act('edit', 'تعديلُ بياناتها',
        () => sermonDialog(s.id, { mosque, friday })) : null,
      // تنقيحُ النصِّ على الكليشة ثم حفظُه (ملاحظة ٣٣٨)
      mayRefine() ? h('a.icon-btn', { href: `/app/sermon-edit/${s.id}`,
        title: 'افتحْها على الكليشة لتُنسَّق وتُحفَظ',
        'aria-label': 'تنقيحٌ على الكليشة' }, ico('pen')) : null,
      mayExport() ? act('word', 'تنزيلُ Word على كليشة الهيئة', btn => dl(async () => {
        const m = await import('../sermondl.js');
        await m.downloadSermonWord(s.id);
      }, btn)) : null,
      mayExport() ? act('pdf', 'تنزيلُ PDF على كليشة الهيئة', btn => dl(async () => {
        const m = await import('../sermondl.js');
        await m.downloadSermonPdf(s.id);
      }, btn)) : null,
      mayExport() ? act('file', 'الملفُّ المرفوعُ كما هو', btn => dl(async () => {
        const m = await import('../sermondl.js');
        await m.openSermonFile(s.id);
      }, btn)) : null,
      mayEdit() ? act('trash', 'حذفُ الخطبة', () => removeSermon(s), 'danger') : null);
  };

  // صفُّ الخطبة — على نسق أرشيف أعمال الترجمة
  const sermonRow = (s, mosque, friday, { acts = true } = {}) => {
    if (!s) {
      return h('div.row.between.wrap.sm-row.gone',
        h('span.small.muted', `${MOSQUE_ICON[mosque]} ${MOSQUE[mosque]} — لم تُضَف`),
        mayUpload()
          ? h('button.btn.xs', { type: 'button',
              onclick: () => sermonDialog(null, { mosque, friday }) }, '⤒ ارفعْ')
          : null);
    }
    const n = Number(s.n_langs || 0);
    return h('div.stack.sm-row', { style: { gap: '4px' } },
      h('div.row.between.wrap',
        h('div', { style: { flex: 1, minWidth: '180px' } },
          h('span.sm-no', AR(s.seq || 0)),
          h('b', mosque
            ? `${MOSQUE_ICON[mosque]} ${s.sermon_type} من ${MOSQUE[mosque]}`
            : `⚠ ${s.sermon_type} — لم يُعرَفْ مسجدُها`),
          h('b.sm-title', ` (${s.title})`),
          // ترميزُ الخطبة بعد عنوانها (ملاحظة ٣٤٥)
          s.doc_no ? h('span.doc-no', { dir: 'ltr', title: 'رقمُ توثيق الخطبة' }, s.doc_no) : null,
          h('div.small.muted',
            [s.khateeb, s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : null),
             s.sermon_date ? fmtDate(s.sermon_date) : null].filter(Boolean).join('، '))),
        acts
          ? h('div.row', { style: { gap: '4px' } },
              h('span.badge', { class: n >= 10 ? 'ok' : n ? 'warn' : 'bad' },
                n ? `${AR(n)} لغة` : 'بلا نسخ'),
              sermonActs(s, mosque, friday))
          : null),
      langChips(s.id, n));
  };

  // وسومُ اللغات: الموجودةُ تُفتح، والناقصةُ تُرفع (ملاحظة ٣٠٣)
  const langChips = (id, n) => {
    const box = h('div.lang-chips');
    const paint = async () => {
      let v = [];
      try {
        const r = await db.rpc('arch_sermon', { p_id: id });
        v = (Array.isArray(r) ? r[0] : r)?.versions || [];
      } catch { v = []; }
      const has = new Set(v.map(x => x.language_code));
      // تُعرَض المرفوعةُ واللغاتُ الرئيسةُ وحدَها في شريطٍ يُمرَّر،
      // وما سواها يُطلَب بزرِّ «＋ لغة» (ملاحظة من الواقع)
      const act = trLangs().filter(l => l.is_active);
      const show = act.filter(l => l.is_core || has.has(l.code));
      const all = ['ar', ...show.map(l => l.code)];
      fill(box, ...all.map(code => {
        const on = has.has(code);
        const b = h('button.lang-chip' + (on ? '.on' : ''), { type: 'button',
          title: on ? 'افتحْها' : 'ارفعْ نسختَها' },
          code === 'ar' ? 'العربية (الأصل)' : langName(code));
        b.onclick = () => (on ? openSermon(id, code)
          : mayUpload() ? addVersion(id, code) : toast('هذا خارجَ نطاقِ عملك الحالي.', 'bad'));
        return b;
      }), mayUpload()
        ? h('button.lang-chip.add', { type: 'button', onclick: () => addVersion(id, null) },
            `＋ لغة (${AR(act.length - show.length)})`)
        : null);
    };
    if (n) paint(); else box.append(h('span.small.muted', 'لا نسخَ بعد'));
    return box;
  };

  // صفٌّ لكلِّ حرمٍ يُطوى ويُفتَح بسهمٍ في آخره (ملاحظة ٣٢٦)
  // وحالُ الطيِّ محفوظةٌ لصاحبها فلا يُعيدها كلَّ مرة
  const FOLD_KEY = `arch-fold-${year}`;
  const readFold = () => {
    try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; }
    catch { return {}; }
  };
  const writeFold = v => { try { localStorage.setItem(FOLD_KEY, JSON.stringify(v)); } catch {} };
  let fold = readFold();
  const isShut = (friday, mosque) => fold[`${friday}|${mosque}`] === 1;
  const setShut = (friday, mosque, on) => {
    if (on) fold[`${friday}|${mosque}`] = 1; else delete fold[`${friday}|${mosque}`];
    writeFold(fold);
  };

  const mosqueLine = (w, mosque) => {
    const s = w[mosque];
    // الغائبُ صفٌّ واحدٌ لا يُطوى: عنوانُه بيانُه، وفيه زرُّ رفعه
    if (!s) {
      return h('div.mosque-group.gone',
        h('div.mosque-head',
          h('b', `${MOSQUE_ICON[mosque]} ${MOSQUE[mosque]}`),
          h('span.small.bad', 'لم تُضَفْ'),
          h('span.row', { style: { gap: '6px', marginInlineStart: 'auto' } },
            mayUpload()
              ? h('button.btn.xs', { type: 'button',
                  onclick: () => sermonDialog(null, { mosque, friday: w.friday_on }) }, '⤒ ارفعْ')
              : null)));
    }
    const shut = isShut(w.friday_on, mosque);
    const n = Number(s.n_langs || 0);
    const arrow = h('button.fold-btn', { type: 'button',
      'aria-expanded': shut ? 'false' : 'true',
      title: shut ? 'افتحْ هذا الصف' : 'اطوِ هذا الصف' }, shut ? '▾' : '▴');
    const inner = h('div.week-body', { hidden: shut },
      sermonRow(s, mosque, w.friday_on, { acts: false }));
    arrow.onclick = () => {
      const now = !inner.hidden;
      inner.hidden = now;
      arrow.textContent = now ? '▾' : '▴';
      arrow.setAttribute('aria-expanded', now ? 'false' : 'true');
      setShut(w.friday_on, mosque, now);
    };
    // الأيقوناتُ في رأس العمود: تُدرَك ولو كان الصفُّ مطويًّا (ملاحظة ٣٣٠)
    return h('div.mosque-group', { class: shut ? 'shut' : '' },
      h('div.mosque-head',
        h('b', `${MOSQUE_ICON[mosque]} ${MOSQUE[mosque]}`),
        h('span.badge', { class: n >= 10 ? 'ok' : n ? 'warn' : 'bad' },
          n ? `${AR(n)} لغة` : 'بلا نسخ'),
        h('span.row.head-acts', { style: { marginInlineStart: 'auto' } },
          sermonActs(s, mosque, w.friday_on), arrow)),
      h('div.mosque-sub.small.muted', s.title || '—',
        s.doc_no ? h('span.doc-no', { dir: 'ltr', title: 'رقمُ توثيق الخطبة' }, s.doc_no) : null),
      inner);
  };

  const weekCard = w => {
    const total = Number(w.langs || 0);
    const have = (w.makkah ? 1 : 0) + (w.madinah ? 1 : 0);
    // وما لم يُعرَف مسجدُه يُعرَض ليُصحَّح، ولا يبقى غائبًا (إصلاح ٣١٦)
    const others = Array.isArray(w.others) ? w.others : [];
    // عمودان: المسجدُ الحرامُ يمينًا والنبويُّ يسارًا (ملاحظة ٣٣٠).
    //   والاتجاهُ من الصفحة: فهي عربيةٌ يمينُها أوّلُها، فيُكتب الحرامُ
    //   أوّلًا فيقع يمينًا.
    const inner = h('div.week-inner',
      h('div.week-cols',
        mosqueLine(w, 'makkah'),
        mosqueLine(w, 'madinah')),
      others.length
        ? h('div.mosque-group.nomosque',
            h('div.mosque-head',
              h('b', '⚠ بلا مسجد'),
              h('span.small.bad', 'حدِّدْ مسجدَها لتأخذ صفَّها')),
            h('div.week-body', others.map(o => sermonRow(o, null, w.friday_on))))
        : null);

    // والأسبوعُ نفسُه يُطوى بسهمٍ في صدره، فتُمرَّر الأسابيعُ كلُّها بيُسر
    const wShut = isShut(w.friday_on, 'week');
    inner.hidden = wShut;
    const arrow = h('button.fold-btn', { type: 'button',
      'aria-expanded': wShut ? 'false' : 'true',
      title: wShut ? 'افتحْ هذا الأسبوع' : 'اطوِ هذا الأسبوع' }, wShut ? '▾' : '▴');
    arrow.onclick = () => {
      const now = !inner.hidden;
      inner.hidden = now;
      arrow.textContent = now ? '▾' : '▴';
      arrow.setAttribute('aria-expanded', now ? 'false' : 'true');
      setShut(w.friday_on, 'week', now);
    };

    return h('section.week-card',
      h('div.week-head',
        arrow,
        h('b', `الأسبوع ${AR(w.week_no)}`),
        h('span.small.muted', `الجمعة ${fmtHijri(w.friday_on)} — ${fmtDate(w.friday_on)}`),
        h('span.row', { style: { gap: '6px', marginInlineStart: 'auto' } },
          others.length
            ? h('span.badge.bad', `${AR(others.length)} بلا مسجد`)
            : null,
          h('span.badge', { class: total ? (total >= 20 ? 'ok' : 'warn') : '' },
            total ? `${AR(total)} نسخة` : 'خالٍ'),
          h('span.badge', { class: have === 2 ? 'ok' : have ? 'warn' : 'bad' },
            have === 2 ? '✓✓' : have ? '✓' : '—'))),
      inner);
  };

  // طيُّ الكلِّ وفتحُه لكلِّ حرمٍ على حِدة
  const foldAll = (mosque, shut) => {
    for (const w of weeks) setShut(w.friday_on, mosque, shut);
    drawWeeks();
  };

  function drawWeeks() {
    fill(body, h('p.muted', 'يُحمَّل…'));
    loadWeeks().then(() => {
      const list = onlyShort ? weeks.filter(w => !(w.makkah && w.madinah) || Number(w.langs) < 20) : weeks;
      fill(body,
        occasions.length
          ? h('section.card.stack',
              h('b', 'خطبٌ في غير الجُمَع'),
              h('p.small.muted', 'العيدان وعرفةُ والاستسقاءُ والكسوف — تُعرَض في مواضعها من التاريخ.'),
              h('div.stack', { style: { gap: '8px' } }, occasions.map(o =>
                sermonRow({ ...o, n_langs: o.n_langs }, o.mosque || 'makkah', o.sermon_date))))
          : null,
        list.length ? h('div.weeks', list.map(weekCard))
          : emptyState('لا أسابيع', 'تُحسَب جُمَعُ العام من تقويمه.'));
    });
  }

  // -------------------------------------------------------------------
  // نافذةُ الخطبة: إنشاءٌ وتعديل
  // -------------------------------------------------------------------
  async function sermonDialog(id, { mosque, friday } = {}) {
    let cur = {};
    if (id) {
      try {
        const r = await db.rpc('arch_sermon', { p_id: id });
        cur = (Array.isArray(r) ? r[0] : r) || {};
      } catch { cur = {}; }
    }
    const langs = trLangs();
    const f = {
      title: h('input', { value: cur.title || '', 'aria-label': 'موضوع الخطبة' }),
      khateeb: h('input', { value: cur.khateeb || '', 'aria-label': 'الخطيب' }),
      date: h('input', { type: 'date',
        value: cur.sermon_date || (friday ? String(friday).slice(0, 10) : ''),
        'aria-label': 'تاريخ الخطبة' }),
      hijri: h('input', { value: cur.hijri_text || '', 'aria-label': 'التاريخ الهجري' }),
      seq: h('input', { type: 'number', min: '1', value: cur.seq || '', 'aria-label': 'رقم الخطبة' }),
      mosque: h('select', { 'aria-label': 'المسجد' },
        Object.entries(MOSQUE).map(([k, v]) =>
          h('option', { value: k, selected: (cur.mosque || mosque) === k }, v))),
      type: h('select', { 'aria-label': 'نوع الخطبة' },
        SERMON_TYPES.map(t => h('option', { value: t,
          selected: (cur.sermon_type || 'خطبة جمعة') === t }, t))),
      notes: h('input', { value: cur.notes || '', 'aria-label': 'ملاحظة' }),
      // ونصُّ الخطبة يُرفَع هنا لا في نافذةٍ أخرى (ملاحظة ٣١٩)
      lang: h('select', { 'aria-label': 'لغة النص' },
        h('option', { value: '' }, '—'),
        h('option', { value: 'ar' }, 'العربية (الأصل)'),
        ...langs.map(l => h('option', { value: l.code }, l.name_ar))),
      file: h('input', { type: 'file', accept: '.docx', 'aria-label': 'ملف Word' }),
      text: h('textarea', { rows: 3, 'aria-label': 'نص الخطبة',
        placeholder: 'أو الصقِ النصَّ هنا' }),
    };

    // التاريخُ الهجريُّ يُولَّد من تاريخ الخطبة لا من العام الجاري (ملاحظة ٣٢٠)
    const hint = h('span.small.muted');
    let hijriTouched = !!cur.hijri_text;
    f.hijri.oninput = () => { hijriTouched = !!f.hijri.value.trim(); };
    const syncHint = () => {
      if (!f.date.value) { hint.textContent = ''; return; }
      const hj = fmtHijri(f.date.value);
      hint.textContent = `${hj} · جمعةُ ${fmtDate(f.date.value)}`;
      if (!hijriTouched) f.hijri.value = hj;
    };
    f.date.oninput = syncHint; syncHint();

    // ملفُّ Word يُقرأ فيصير نصًّا، ويُقترَح منه ما خلا من البيانات
    const fileNote = h('span.small.muted');
    let body_html = '';
    f.file.onchange = async () => {
      const file = f.file.files?.[0];
      if (!file) { body_html = ''; fileNote.textContent = ''; return; }
      try {
        const [{ readDocxParagraphs }, imp] = await Promise.all([
          import('../docxread.js'), import('../archimport.js')]);
        const paras = await readDocxParagraphs(file);
        const r = imp.splitSermons(paras, { year });
        const one = r.rows[0] || {};
        body_html = one.html || paras.map(p => p.html).filter(Boolean).join('\n');
        if (!f.title.value && one.title) f.title.value = one.title;
        if (!f.khateeb.value && one.khateeb) f.khateeb.value = one.khateeb;
        if (!f.date.value && one.date) { f.date.value = one.date; syncHint(); }
        if (one.mosque) f.mosque.value = one.mosque;
        if (!f.lang.value) {
          const c = imp.langOfName(file.name);
          if (c) f.lang.value = c;
        }
        fileNote.textContent = `قُرئ: ${imp.countWords(
          new DOMParser().parseFromString(body_html, 'text/html').body.textContent)} كلمة`;
      } catch (e) { body_html = ''; fileNote.textContent = e.message; }
    };

    const res = await dialog({
      title: id ? 'تعديلُ خطبة' : 'إضافةُ خطبة',
      body: h('div.stack.tight.sermon-form',
        h('label.field', 'موضوع الخطبة', f.title),
        h('div.grid-3',
          h('label.field', 'الخطيب', f.khateeb),
          h('label.field', 'المسجد', f.mosque),
          h('label.field', 'النوع', f.type),
          h('label.field', 'التاريخ', f.date),
          h('label.field', 'الهجري كما يُكتب', f.hijri),
          h('label.field', 'رقم الخطبة', f.seq)),
        hint,
        h('div.grid-3',
          h('label.field', 'لغة النص', f.lang),
          h('label.field', 'ملف Word', f.file),
          h('label.field', 'ملاحظة', f.notes)),
        fileNote,
        h('label.field', 'أو النص', f.text)),
      buttons: [{ label: 'حفظ', kind: 'primary',
        validate: () => (f.title.value.trim() ? true : 'اكتب موضوعَ الخطبة'),
        value: () => {
          const txt = f.text.value.trim();
          const html = body_html
            || (txt ? txt.split(/\n{2,}/).map(x =>
                 `<p>${x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`).join('\n')
               : '');
          return {
            id: id || null, section_id: section?.id,
            title: f.title.value.trim(), khateeb: f.khateeb.value.trim() || null,
            mosque: f.mosque.value, sermon_type: f.type.value,
            sermon_date: f.date.value || null, hijri_text: f.hijri.value.trim() || null,
            seq: f.seq.value ? Number(f.seq.value) : null,
            notes: f.notes.value.trim() || null,
            versions: (f.lang.value && html)
              ? [{ language_code: f.lang.value, is_source: f.lang.value === 'ar',
                   body_html: html }]
              : []
          };
        } }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      const sid = await db.rpc('save_arch_sermon', { p: res });
      // وملفُّ Word نفسُه يُحفَظ مع نسخته لا نصُّه وحدَه، فتعمل أيقونةُ
      //   «الملفُّ المرفوعُ كما هو» (ملاحظة ٣٤٧)
      const fl = f.file.files?.[0];
      if (sid && fl && f.lang.value) {
        try {
          const safe = String(fl.name).replace(/[^\w.\-]+/g, '_');
          const at = `${sid}/${Date.now()}_${safe}`;
          await storage.upload('repo', at, fl);
          await db.rpc('save_arch_sermon', { p: { id: sid, section_id: section?.id,
            versions: [{ language_code: f.lang.value, file_path: at,
                         is_source: f.lang.value === 'ar' }] } });
        } catch (e) { toast(`حُفظت الخطبة، وتعذّر حفظُ الملف: ${e.message}`, 'warn'); }
      }
      toast(id ? 'حُفظ التعديل.' : 'أُضيفت الخطبة.', 'ok');
      sections = await db.rpc('arch_section_tiles', { p_year: year }) || [];
      section = sections.find(s => s.id === section?.id) || section;
      drawSecs(); drawWeeks();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function removeSermon(s) {
    if (!await confirm('حذفُ خطبة',
      `تُحذف «${s.title}» ونسخُها كلُّها. والحذفُ لا يُستدرك.`, 'احذفْها', 'danger')) return;
    try {
      await db.rpc('delete_arch_sermon', { p_id: s.id });
      toast('حُذفت الخطبة.', 'ok');
      drawWeeks();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // رفعُ نسخةٍ بلغة
  async function addVersion(id, code) {
    const lang = h('select', { 'aria-label': 'اللغة' },
      h('option', { value: 'ar', selected: code === 'ar' }, 'العربية (الأصل)'),
      trLangs().filter(l => l.is_active).map(l =>
        h('option', { value: l.code, selected: code === l.code }, l.name_ar)));
    const file = h('input', { type: 'file', accept: '.pdf,.doc,.docx', 'aria-label': 'ملف النسخة' });
    const text = h('textarea', { rows: 5, 'aria-label': 'نصّ النسخة' });
    const note = h('small.muted');
    // الرفعُ يستغرق، والحفظُ كان يسبقه فيُحفَظ بلا ملفٍّ ثم يُقال
    //   «لا ملفَّ مرفوع». فصار الحفظُ ينتظر رفعَه (ملاحظة ٣٤٧)
    let path = null;
    let pending = null;
    file.onchange = () => {
      const fl = file.files[0];
      if (!fl) { path = null; pending = null; note.textContent = ''; return; }
      note.textContent = 'يُرفَع الملف…';
      pending = (async () => {
        const safe = String(fl.name).replace(/[^\w.\-]+/g, '_');
        const at = `${id}/${Date.now()}_${safe}`;
        try {
          await storage.upload('repo', at, fl);
          path = at;
          note.textContent = `رُفع الملف: ${fl.name}`;
        } catch (e) {
          path = null;
          note.textContent = `تعذّر رفعُ الملف: ${e.message}`;
          throw e;
        }
      })();
      pending.catch(() => { /* الخطأُ مكتوبٌ في السطر */ });
    };

    const res = await dialog({
      title: 'نسخةٌ بلغة',
      body: h('div.stack',
        h('p.small.muted', 'النصُّ يُبنى به المجمَّعُ السنوي، والملفُّ يُحفَظ معه ويُنزَّل.'),
        h('label.field', 'اللغة', lang),
        h('label.field', 'ملفُّ النسخة (PDF أو وورد)', file, note),
        h('label.field', 'النصّ', text)),
      buttons: [{ label: 'حفظ', kind: 'primary',
        validate: async () => {
          if (pending) {
            try { await pending; } catch { return 'تعذّر رفعُ الملف — أعِدْ اختيارَه'; }
          }
          if (!path && !text.value.trim()) return 'ارفعْ ملفًا أو الصقِ النصّ';
          return true;
        },
        value: () => ({ language_code: lang.value, body_html: text.value.trim() || null,
          file_path: path, is_source: lang.value === 'ar' }) }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      // لا يُرسَل عنوانٌ ولا تاريخ: ما لا يُذكَر يبقى على حاله (إصلاح ٣٤٩)
      await db.rpc('save_arch_sermon', { p: { id, section_id: section?.id,
        versions: [res] } });
      toast('حُفظت النسخة.', 'ok');
      drawWeeks();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // عرضُ الخطبة ونسخِها
  async function openSermon(id, code = null) {
    let s = {};
    try {
      const r = await db.rpc('arch_sermon', { p_id: id });
      s = (Array.isArray(r) ? r[0] : r) || {};
    } catch (e) { return toast(e.message, 'bad'); }
    const vs = s.versions || [];
    const box = h('div.stack');

    const show = async v => {
      fill(box, h('p.muted', 'يُحمَّل…'));
      let t = {};
      try {
        const r = await db.rpc('arch_version_text', { p_sermon: id, p_lang: v.language_code });
        t = (Array.isArray(r) ? r[0] : r) || {};
      } catch (e) { return fill(box, h('p.small.warn', e.message)); }
      const openFile = h('button.btn.xs', { type: 'button' }, 'افتحِ الملف');
      openFile.onclick = () => busy(openFile, async () => {
        try { window.open(await storage.signedUrl('repo', t.file_path, 600), '_blank', 'noopener'); }
        catch (e) { toast(e.message, 'bad'); }
      });
      fill(box,
        h('div.row.between.wrap',
          h('b', v.language_code === 'ar' ? 'العربية (الأصل)' : langName(v.language_code)),
          h('div.row', { style: { gap: '6px' } },
            t.doc_no ? h('span.badge', { dir: 'ltr' }, t.doc_no) : null,
            t.file_path ? openFile : null)),
        t.body_html
          ? h('div.arch-text', { dir: v.language_code === 'ar' ? 'rtl' : 'auto' },
              String(t.body_html).replace(/<[^>]*>/g, ' ').slice(0, 4000))
          : h('p.small.muted', 'لا نصَّ محفوظٌ لهذه النسخة — الملفُّ وحدَه.'));
    };

    const first = vs.find(v => v.language_code === (code || 'ar')) || vs[0];
    if (first) show(first);

    await dialog({
      title: s.title || 'خطبة',
      body: h('div.stack',
        h('p.small.muted',
          [s.sermon_type, MOSQUE[s.mosque], s.khateeb,
           s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : null),
           s.week_no ? `الأسبوع ${AR(s.week_no)}` : null].filter(Boolean).join(' · ')),
        h('div.lang-chips', vs.map(v => {
          const b = h('button.lang-chip.on', { type: 'button' },
            v.language_code === 'ar' ? 'العربية' : langName(v.language_code),
            v.has_audio ? ico('audio') : null);
          b.onclick = () => show(v);
          return b;
        })),
        box),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  }

  // -------------------------------------------------------------------
  const shortBtn = h('button.btn.sm.ghost', { type: 'button' }, 'ما نقص وحدَه');
  shortBtn.onclick = () => {
    onlyShort = !onlyShort;
    shortBtn.classList.toggle('primary', onlyShort);
    shortBtn.textContent = onlyShort ? 'اعرضْ كلَّ الأسابيع' : 'ما نقص وحدَه';
    drawWeeks();
  };

  // الرفعُ الجماعي: مجمَّعُ العام في ملفٍ واحدٍ يُشقُّ خطبًا (ملاحظة ٣٠٥)
  const bulkBtn = mayUpload()
    ? h('button.btn.sm', { type: 'button' }, '⇪ رفعٌ جماعي')
    : null;
  if (bulkBtn) {
    bulkBtn.onclick = async () => {
      if (!section) { toast('أضِفْ قسمًا أولًا', 'warn'); return; }
      const { importDialog } = await import('../archimport.js');
      await importDialog({
        sectionId: section.id, year,
        onDone: async () => {
          sections = await db.rpc('arch_section_tiles', { p_year: year }) || [];
          section = sections.find(x => x.id === section?.id) || section;
          drawSecs(); drawWeeks();
        },
      });
    };
  }

  // طيُّ الحرمين وفتحُهما (ملاحظة ٣٢٦)
  const foldBar = h('div.row.gap.wrap.fold-bar',
    h('span.small.muted', 'الطيّ:'),
    ...Object.entries(MOSQUE).flatMap(([k, v]) => [
      h('button.btn.xs', { type: 'button', onclick: () => foldAll(k, true) }, `اطوِ ${v}`),
      h('button.btn.xs.ghost', { type: 'button', onclick: () => foldAll(k, false) }, `افتحْ ${v}`),
    ]),
    h('button.btn.xs', { type: 'button', onclick: () => foldAll('week', true) }, 'اطوِ الأسابيع'),
    h('button.btn.xs.ghost', { type: 'button', onclick: () => foldAll('week', false) }, 'افتحِ الأسابيع'),
    h('button.btn.xs', { type: 'button',
      onclick: () => { ['week', ...Object.keys(MOSQUE)].forEach(k => foldAll(k, true)); } }, 'اطوِ الكلَّ'),
    h('button.btn.xs.ghost', { type: 'button',
      onclick: () => { ['week', ...Object.keys(MOSQUE)].forEach(k => foldAll(k, false)); } }, 'افتحِ الكلَّ'));

  // ترحيلُ أعمال العام المنجَزة من أرشيف الترجمة (ملاحظة ٣٣٧)
  const carryBtn = mayCarry()
    ? h('button.btn.sm', { type: 'button', title: 'نقلُ أعمال العام المنجَزة إلى الأرشيف' },
        '⇄ رحِّلْ من أرشيف الترجمة')
    : null;
  if (carryBtn) {
    carryBtn.onclick = () => busy(carryBtn, async () => {
      const { carryDialog } = await import('../archcarry.js');
      await carryDialog(year, section, { onDone: async () => {
        sections = await db.rpc('arch_section_tiles', { p_year: year }) || [];
        section = sections.find(x => x.id === section?.id) || section;
        drawSecs(); drawWeeks();
      } });
    });
  }

  // إعادةُ ترقيم العام بالتاريخ (ملاحظة ٣٢٧)
  const numBtn = mayEdit()
    ? h('button.btn.sm.ghost', { type: 'button' }, '№ أعِدْ ترقيمَ العام')
    : null;
  if (numBtn) {
    numBtn.onclick = async () => {
      const per = h('input', { type: 'checkbox' });
      const res = await dialog({
        title: `إعادةُ ترقيم خطب ${ARY(year)}هـ`,
        body: h('div.stack',
          h('p.small.muted', 'تُرتَّب خطبُ العام بتاريخها ويُعاد ترقيمُها من واحد. '
            + 'وما كتبتَه من أرقامٍ يدويةٍ يُستبدَل.'),
          h('label.check', per, h('span', 'ترقيمٌ مستقلٌّ لكلِّ حرم'))),
        buttons: [{ label: 'أعِدِ الترقيم', kind: 'primary', value: () => ({ per: per.checked }) },
                  { label: 'إلغاء', value: null }]
      });
      if (!res) return;
      try {
        const n = await db.rpc('renumber_arch_year', { p_year: year, p_per_mosque: res.per });
        toast(`أُعيد ترقيمُ ${AR(n || 0)} خطبة.`, 'ok');
        drawWeeks();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  const bookBtn = mayExport()
    ? h('button.btn.sm.primary', { type: 'button' }, '📕 أصدِرْ مجمَّعًا')
    : null;
  if (bookBtn) {
    bookBtn.onclick = async () => {
      const { bookDialog } = await import('../sermonbook.js');
      bookDialog(year, section);
    };
  }

  drawSecs();
  drawWeeks();

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        bookBtn, bulkBtn, carryBtn, numBtn, shortBtn,
        mayUpload()
          ? h('button.btn.sm', { type: 'button',
              onclick: () => sermonDialog(null, {}) }, '＋ خطبة')
          : null,
        h('a.btn.sm.ghost', { href: '/app/sermons' }, 'كلُّ الأعوام')),
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', `خطبُ عام ${ARY(year)}هـ`),
        h('p.muted', 'أسابيعُ الجُمَع: في كلِّ أسبوعٍ خطبتان، ولكلِّ خطبةٍ لغاتُها. '
          + 'والغائبُ يبقى صفًّا موسومًا فيُبصَر الناقص.'))),
    secBar,
    foldBar,
    body);
}
