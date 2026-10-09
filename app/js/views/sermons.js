// أرشيفُ الخطب السنوي: أعوامٌ وأقسامٌ وأسابيعُ جُمَع (ملاحظة ٣٠٣)
//
//   يُفتح على أيقونات الأعوام، وفي العام أقسامُه، وفي القسم أسابيعُ
//   الجُمَع — في كلِّ أسبوع صفَّان: المسجدُ الحرامُ والمسجدُ النبويّ،
//   وتحت كلٍّ لغاتُه. والغائبُ يبقى صفًّا خاليًا موسومًا، فيُبصَر
//   الناقصُ بالنظر لا بالبحث.
//
//   والمجمَّعُ السنويُّ يُولَّد من هذه الخطب لا يُرفَع جاهزًا (ملاحظة ٣٠٩).
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDate, fmtHijri, hijriDay } from '../ui.js';
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
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  // رفعُ نسخةٍ أو استبدالُها، وإضافةُ صفِّ لغة، وحذفُ صفِّه، والإصدارُ
  // على قالب المجمَّع (ملاحظات ٣٦٥ و٣٧٠)
  up:    '<path d="M12 20V8"/><path d="M7 12l5-5 5 5"/><path d="M4 4h16"/>',
  plus:  '<path d="M12 5v14M5 12h14"/>',
  hide:  '<path d="M4 4l16 16"/><path d="M10.6 5.3A9 9 0 0 1 22 12a16 16 0 0 1-3.3 4"/>'
         + '<path d="M6.3 7.3A16 16 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 3.9-.8"/>',
  book:  '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/>'
         + '<path d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z"/>'
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
        // تصديرُ الأرشيف للتخزين مشجَّرًا (ملاحظتا ٣٨٣ و٣٨٥)
        mayExport()
          ? h('button.btn.sm', { type: 'button',
              title: 'مضغوطٌ مشجَّر: عامٌ ← شهرٌ ← لغةٌ ← ملفاتُ الخطب',
              onclick: ev => busy(ev.currentTarget, async () => {
                const m = await import('../archstore.js');
                await m.storeDialog();
              }) }, '🗄 تصديرٌ للتخزين')
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
// ---------------------------------------------------------------------
// ٢) العام: أقسامُه، ثم اثنتا عشرة بطاقةً على أشهره، ثم أسابيعُ الشهر
//
//   كان العامُ ينزل دفعةً واحدة: إحدى وخمسون جمعةً في قائمةٍ واحدة،
//   ولغاتُ الخطبة وسومًا مرصوفةً تحت صفِّها. فصار يُفتح على أشهره —
//   وهو ما يستحضره الناسُ: «رجب» لا «الأسبوع ٢٨» — وصار لكلِّ لغةٍ
//   صفُّها بأيقوناتها ورمزِ توثيقها (ملاحظات ٣٦٥–٣٧٠).
// ---------------------------------------------------------------------
const H_MONTHS = ['محرَّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى',
  'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
const monthName = m => H_MONTHS[(Number(m) || 1) - 1] || `الشهر ${AR(m)}`;
// ترتيبُ الشهر بالكلمات: «الشهرُ الأول — ٤ محرَّم» (ملاحظة ٣٧٨)
const H_ORDER = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس',
  'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر'];
const monthOrder = m => H_ORDER[(Number(m) || 1) - 1] || AR(m);

async function yearPage(ctx, year) {
  let sections = [];
  try { sections = await db.rpc('arch_section_tiles', { p_year: year }) || []; } catch { sections = []; }

  const wanted = ctx?.query?.get('s') || '';
  let section = sections.find(s => s.id === wanted) || sections[0] || null;

  // لغاتُ العام: يُرسَم لكلٍّ منها صفٌّ في كلِّ خطبةٍ ولو لم تُرفَع بعد
  let yearLangs = [];
  const loadLangs = async () => {
    try { yearLangs = await db.rpc('arch_year_langs', { p_year: year }) || []; }
    catch { yearLangs = [{ code: 'ar', name_ar: 'العربية' }]; }
  };

  const body     = h('div.stack');
  const secBar   = h('div.sec-bar');
  const monthBar = h('div.month-grid');

  // -------------------------------------------------------------------
  // الأقسام: تُضاف وتُسمّى وتُعدَّل وتُحذَف (ملاحظتا ٣٥٨ و٣٦٤)
  // -------------------------------------------------------------------
  const drawSecs = () => {
    fill(secBar, ...[
      ...sections.map(s => {
        const on = section && s.id === section.id;
        const b = h('div.sec-tile' + (on ? '.on' : ''),
          h('button.sec-pick', { type: 'button', 'aria-label': `القسم ${s.name}` },
            h('span.sec-ico', typeIcon(s.icon || 'خطب', { size: 20 })),
            h('b', s.name),
            h('span.small.muted', `${AR(s.sermons)} خطبة · ${AR(s.versions)} نسخة`)),
          mayUpload()
            ? h('span.sec-acts',
                h('button.icon-btn', { type: 'button', title: 'تعديلُ القسم',
                  'aria-label': 'تعديلُ القسم',
                  onclick: ev => { ev.stopPropagation(); editSection(s); } }, ico('edit')),
                h('button.icon-btn.danger', { type: 'button', title: 'حذفُ القسم',
                  'aria-label': 'حذفُ القسم',
                  onclick: ev => { ev.stopPropagation(); removeSection(s); } }, ico('trash')))
            : null);
        b.querySelector('.sec-pick').onclick = () => {
          section = s; drawSecs(); drawMonths(); drawWeeks();
        };
        return b;
      }),
      mayUpload()
        ? h('button.sec-tile.add', { type: 'button', onclick: addSection },
            h('b', '＋ قسم'), h('span.small.muted', 'يُسمّى بحرّية'))
        : null
    ].filter(Boolean));
  };

  const sectionForm = (cur = {}) => {
    const name = h('input', { value: cur.name || '',
      placeholder: 'الدروس · الكتب · التوجيهات', 'aria-label': 'اسم القسم' });
    const icon = h('select', { 'aria-label': 'الأيقونة' },
      ['خطب', 'دروس علمية', 'كتب', 'مطويات', 'منشورات', 'إعلانات', 'توجيهات']
        .map(t => h('option', { value: t, selected: (cur.icon || 'خطب') === t }, t)));
    return { name, icon,
      el: h('div.stack', h('label.field', 'اسم القسم', name), h('label.field', 'الأيقونة', icon)) };
  };

  async function addSection() {
    const f = sectionForm();
    const res = await dialog({
      title: `قسمٌ جديدٌ في ${ARY(year)}هـ`,
      body: f.el,
      buttons: [{ label: 'أضِفْه', kind: 'primary',
        validate: () => (f.name.value.trim().length > 1 ? true : 'اكتب اسمَ القسم'),
        value: () => ({ name: f.name.value.trim(), icon: f.icon.value }) },
        { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('add_arch_section', { p_year: year, p_name: res.name, p_icon: res.icon });
      await reloadSections(res.name);
      toast('أُضيف القسم.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  // تغييرُ اسم القسم بعد إنشائه — لم يكن له سبيل (ملاحظة ٣٥٨)
  async function editSection(s) {
    const f = sectionForm(s);
    const res = await dialog({
      title: 'تعديلُ القسم',
      body: h('div.stack',
        h('p.small.muted', 'يُغيَّر اسمُ القسم وأيقونتُه، وتبقى خطبُه كما هي.'),
        f.el),
      buttons: [{ label: 'احفظْ', kind: 'primary',
        validate: () => (f.name.value.trim().length > 1 ? true : 'اكتب اسمَ القسم'),
        value: () => ({ name: f.name.value.trim(), icon: f.icon.value }) },
        { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('rename_arch_section', { p_id: s.id, p_name: res.name, p_icon: res.icon });
      await reloadSections(res.name);
      toast('حُفظ التعديل.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  // وحذفُه — وفي القسم خطبٌ فلا يُحذَف صمتًا (ملاحظة ٣٦٤)
  async function removeSection(s) {
    const n = Number(s.sermons || 0);
    const others = sections.filter(x => x.id !== s.id);
    if (!others.length) return toast('لا يُحذف آخرُ قسمٍ في العام.', 'bad');
    if (!n) {
      if (!await confirm('حذفُ قسم', `يُحذف قسمُ «${s.name}» وهو خالٍ.`, 'احذفْه', 'danger')) return;
      try {
        await db.rpc('delete_arch_section', { p_id: s.id, p_force: false });
        await reloadSections(null);
        toast('حُذف القسم.', 'ok');
      } catch (e) { toast(e.message, 'bad'); }
      return;
    }
    const to = h('select', { 'aria-label': 'القسم المنقولُ إليه' },
      others.map(x => h('option', { value: x.id }, x.name)));
    const res = await dialog({
      title: `حذفُ قسم «${s.name}»`,
      body: h('div.stack',
        h('p.small.warn', `في هذا القسم ${AR(n)} خطبة. انقلْها إلى قسمٍ آخر، `
          + 'أو احذفْها معه — والحذفُ لا يُستدرك.'),
        h('label.field', 'انقلْ خطبَه إلى', to)),
      buttons: [
        { label: 'انقلْها ثمَّ احذفِ القسم', kind: 'primary', value: () => ({ move: to.value }) },
        { label: 'احذفْه بما فيه', kind: 'danger', value: () => ({ move: null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      if (res.move) await db.rpc('move_arch_sermons', { p_from: s.id, p_to: res.move });
      await db.rpc('delete_arch_section', { p_id: s.id, p_force: !res.move });
      await reloadSections(null);
      toast(res.move ? 'نُقلت الخطبُ وحُذف القسم.' : 'حُذف القسمُ بما فيه.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function reloadSections(preferName) {
    sections = await db.rpc('arch_section_tiles', { p_year: year }) || [];
    section = (preferName ? sections.find(x => x.name === preferName) : null)
      || sections.find(x => x.id === section?.id) || sections[0] || null;
    drawSecs(); drawMonths(); drawWeeks();
  }

  // -------------------------------------------------------------------
  // الأسابيعُ والأشهر
  // -------------------------------------------------------------------
  let weeks = [];
  let months = [];
  let occasions = [];
  let onlyShort = false;
  // الشهرُ المفتوح: محفوظٌ لصاحبه فلا يعيد اختيارَه كلَّ مرة
  const MKEY = `arch-month-${year}`;
  let month = (() => {
    try { return Number(localStorage.getItem(MKEY)) || 0; } catch { return 0; }
  })();
  const setMonth = m => {
    month = m;
    try { if (m) localStorage.setItem(MKEY, String(m)); else localStorage.removeItem(MKEY); } catch {}
  };

  async function loadWeeks() {
    const p = { p_year: year, p_section: section ? section.id : null };
    try {
      [weeks, occasions, months] = await Promise.all([
        db.rpc('arch_weeks', p).catch(() => []),
        db.rpc('arch_occasions', p).catch(() => []),
        db.rpc('arch_month_tiles', p).catch(() => [])
      ]);
    } catch { weeks = []; occasions = []; months = []; }
  }

  // بطاقاتُ الأشهر: اثنتا عشرة بطاقةً بإحصائها (ملاحظة ٣٦٩)
  function drawMonths() {
    const rows = months.length ? months : [];
    fill(monthBar, ...(rows.length
      ? rows.map(m => {
          const pct = m.fridays ? Math.round((m.covered / m.fridays) * 100) : 0;
          const on = month === Number(m.h_month);
          // اسمُ البطاقة أولُ جُمَعِ الشهر لا عددُها (ملاحظة ٣٧٨)
          const firstOn = `${AR(m.first_day || hijriDay(m.first_friday) || 1)} ${monthName(m.h_month)}`;
          const b = h('button.month-tile' + (on ? '.on' : ''), { type: 'button',
            'aria-pressed': on ? 'true' : 'false',
            title: `الشهرُ ${monthOrder(m.h_month)} — ${firstOn}`
                 + ` · ${AR(m.fridays)} جُمَع` },
            h('div.m-top',
              h('span.m-ord', `الشهرُ ${monthOrder(m.h_month)}`),
              h('span.m-pct', { class: pct >= 90 ? 'ok' : pct >= 50 ? 'warn' : 'bad' },
                `${AR(pct)}٪`)),
            h('b.m-name', firstOn),
            h('div.year-bar',
              h('span', { style: { width: `${Math.max(2, pct)}%` },
                class: pct >= 90 ? 'ok' : pct >= 50 ? 'warn' : 'bad' })),
            h('div.m-stats',
              h('span.badge', { class: m.sermons ? 'ok' : '' }, `${AR(m.sermons)} خطبة`),
              h('span.badge', { class: m.versions ? 'ok' : '' }, `${AR(m.versions)} نسخة`),
              h('span.badge', { class: Number(m.gaps) ? 'bad' : 'ok' },
                Number(m.gaps) ? `${AR(m.gaps)} ناقصة` : 'مكتمل')));
          b.onclick = () => { setMonth(on ? 0 : Number(m.h_month)); drawMonths(); drawWeeks(); };
          return b;
        })
      : [h('p.small.muted', 'لا أشهرَ — تُحسَب من تقويم العام.')]));
  }

  // -------------------------------------------------------------------
  // أيقوناتُ الخطبة: ما يعمُّ نسخَها (ملاحظة ٣٧٠)
  // -------------------------------------------------------------------
  const sermonActs = (s, mosque, friday) => h('span.sm-acts',
    mayEdit() ? act('edit', 'تعديلُ بيانات الخطبة',
      () => sermonDialog(s.id, { mosque, friday })) : null,
    mayUpload() ? act('plus', 'أضِفْ صفَّ لغةٍ أخرى', () => addLangRow(s)) : null,
    mayExport() ? act('book', 'أصدِرْها على قالب المجمَّع', () => bookOne(s, mosque)) : null,
    mayEdit() ? act('trash', 'حذفُ الخطبة بنسخها', () => removeSermon(s), 'danger') : null);

  const act = (name, title, run, cls = '') =>
    h('button.icon-btn' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title,
      onclick: ev => run(ev.currentTarget) }, ico(name));

  const dl = async (fn, btn) => {
    try { await busy(btn, async () => { await fn(); }); }
    catch (e) { toast(e.message, 'bad'); }
  };

  // -------------------------------------------------------------------
  // صفُّ اللغة: عنوانٌ ومسجدٌ ولغةٌ ورمزُ توثيق، وأمامها أيقوناتُها
  //   (ملاحظات ٣٦٥ و٣٦٦ و٣٧٠)
  //
  //   والصفوفُ الخاليةُ تُرسَم هنا ولا تُخزَّن في قاعدة البيانات: ما
  //   لم يُرفَع فيه شيءٌ لا يُكتب، فيبقى الإحصاءُ صادقًا.
  // -------------------------------------------------------------------
  // ـــ أيقوناتُ الصفِّ كاملةٌ في كلِّ لغة، وما لا يصلح منها يُقال
  //   سببُه عند الضغط ولا يُخفى (ملاحظة ٣٨٨)
  const langRow = (s, mosque, friday, code, v) => {
    const on = !!v;
    const name = code === 'ar' ? 'العربية (الأصل)' : (langName(code) || code);
    const need = (ok, why) => (ok ? true : (toast(why, 'warn'), false));
    const acts = on
      ? [
          act('open', 'استعراضُ النص', () => openSermon(s.id, code)),
          mayRefine() ? h('a.icon-btn', { href: `/app/sermon-edit/${s.id}?lang=${code}`,
            title: 'افتحْها على الكليشة لتُنسَّق وتُحفَظ',
            'aria-label': 'تنقيحٌ على الكليشة' }, ico('pen')) : null,
          mayExport() ? act('word', 'تنزيلُ Word على كليشة الهيئة', btn => {
            if (!need(v.has_text, 'لا نصَّ محفوظٌ لهذه النسخة — الملفُّ وحدَه.')) return;
            dl(async () => {
              const m = await import('../sermondl.js');
              await m.downloadSermonWord(s.id, code);
            }, btn);
          }, v.has_text ? '' : 'dim') : null,
          mayExport() ? act('pdf', 'تنزيلُ PDF على كليشة الهيئة', btn => {
            if (!need(v.has_text, 'لا نصَّ محفوظٌ لهذه النسخة — الملفُّ وحدَه.')) return;
            dl(async () => {
              const m = await import('../sermondl.js');
              await m.downloadSermonPdf(s.id, code);
            }, btn);
          }, v.has_text ? '' : 'dim') : null,
          mayExport() ? act('file', 'الملفُّ المرفوعُ كما هو', btn => {
            if (!need(v.has_file, 'لا ملفَّ مرفوعٌ لهذه النسخة — النصُّ وحدَه.')) return;
            dl(async () => {
              const m = await import('../sermondl.js');
              await m.openSermonFile(s.id, code);
            }, btn);
          }, v.has_file ? '' : 'dim') : null,
          mayUpload() ? act('up', 'استبدلْ ملفَّها أو نصَّها', () => addVersion(s.id, code)) : null,
          mayEdit() ? act('trash', 'حذفُ هذه النسخة', () => removeVersion(s, code), 'danger') : null
        ]
      : [
          mayUpload() ? act('up', 'ارفعْ نسختَها بهذه اللغة', () => addVersion(s.id, code)) : null,
          mayEdit() && code !== 'ar'
            ? act('hide', 'احذفْ صفَّ هذه اللغة من الخطبة', () => hideLang(s, code)) : null
        ];
    // «خطبةُ الجمعة ٣ محرَّم» ثمَّ العنوانُ ثمَّ المسجدُ ثمَّ اللغة (ملاحظة ٣٨١)
    const when = s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : '');
    return h('div.lang-row' + (on ? '.has' : '.empty'),
      h('span.lr-title', { title: `${s.sermon_type || 'خطبة'} ${when} — ${s.title || ''}` },
        h('span.lr-when', when ? `${s.sermon_type || 'خطبة'} ${when}` : (s.sermon_type || 'خطبة')),
        h('b.lr-name', s.title || '—')),
      h('span.lr-mosque', { title: mosque ? MOSQUE[mosque] : 'بلا مسجد' },
        mosque ? MOSQUE_ICON[mosque] : '⚠',
        h('span.lr-mq-name', mosque ? ` ${MOSQUE[mosque]}` : ' بلا مسجد')),
      h('span.lr-lang', name),
      on && v.doc_no
        ? h('span.doc-no', { dir: 'ltr', title: 'رمزُ توثيق النسخة' }, v.doc_no)
        : h('span.lr-no.small.muted', on ? '—' : 'لم تُرفَعْ'),
      h('span.lr-acts', ...acts.filter(Boolean)));
  };

  const langRowsOf = (s, mosque, friday) => {
    const have = new Map((s.versions || []).map(v => [v.language_code, v]));
    const skip = new Set(s.skip_langs || []);
    const codes = [];
    for (const l of yearLangs) {
      if (!skip.has(l.code) || have.has(l.code)) codes.push(l.code);
    }
    for (const c of have.keys()) if (!codes.includes(c)) codes.push(c);
    return codes.map(code => langRow(s, mosque, friday, code, have.get(code)));
  };

  // -------------------------------------------------------------------
  // صفُّ الحرم: رأسٌ فيه أيقوناتُ الخطبة، وتحته صفوفُ لغاتها
  // -------------------------------------------------------------------
  const FOLD_KEY = `arch-fold-${year}`;
  const readFold = () => {
    try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; }
    catch { return {}; }
  };
  const writeFold = v => { try { localStorage.setItem(FOLD_KEY, JSON.stringify(v)); } catch {} };
  let fold = readFold();
  // صفوفُ اللغات مطويّةٌ ابتداءً، وعلى رأس العمود عدَّادُها «٣ من ١٠»،
  //   فيُبصَر الناقصُ بلا أن ينزل العامُ دفعةً واحدة (ملاحظة ٣٦٨).
  //   والأسبوعُ مفتوحٌ ابتداءً. وما فُتح أو طُوي صريحًا حُفظ لصاحبه.
  const isShut = (friday, mosque) => {
    const v = fold[`${friday}|${mosque}`];
    if (v === 1) return true;
    if (v === 0) return false;
    return mosque !== 'week';
  };
  const setShut = (friday, mosque, on) => {
    fold[`${friday}|${mosque}`] = on ? 1 : 0;
    writeFold(fold);
  };

  const mosqueLine = (w, mosque) => {
    const s = w[mosque];
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
    const total = (s.skip_langs || []).length
      ? yearLangs.filter(l => !(s.skip_langs || []).includes(l.code)).length
      : yearLangs.length;
    const arrow = h('button.fold-btn', { type: 'button',
      'aria-expanded': shut ? 'false' : 'true',
      title: shut ? 'افتحْ صفوفَ لغاتها' : 'اطوِ صفوفَ لغاتها' }, shut ? '▾' : '▴');
    const inner = h('div.week-body.lang-rows', { hidden: shut }, ...langRowsOf(s, mosque, w.friday_on));
    arrow.onclick = () => {
      const now = !inner.hidden;
      inner.hidden = now;
      arrow.textContent = now ? '▾' : '▴';
      arrow.setAttribute('aria-expanded', now ? 'false' : 'true');
      setShut(w.friday_on, mosque, now);
    };
    return h('div.mosque-group', { class: shut ? 'shut' : '' },
      h('div.mosque-head',
        h('b', `${MOSQUE_ICON[mosque]} ${MOSQUE[mosque]}`),
        h('span.badge', { class: n >= total ? 'ok' : n ? 'warn' : 'bad' },
          `${AR(n)} من ${AR(total)} لغة`),
        h('span.row.head-acts', { style: { marginInlineStart: 'auto' } },
          sermonActs(s, mosque, w.friday_on), arrow)),
      h('div.mosque-sub.small.muted', s.title || '—',
        s.doc_no ? h('span.doc-no', { dir: 'ltr', title: 'رقمُ توثيق الخطبة' }, s.doc_no) : null,
        h('span.small.muted', ' '),
        h('span.small.muted', [s.khateeb,
          s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : null)]
          .filter(Boolean).join(' · '))),
      inner);
  };

  const weekCard = w => {
    const total = Number(w.langs || 0);
    const have = (w.makkah ? 1 : 0) + (w.madinah ? 1 : 0);
    const others = Array.isArray(w.others) ? w.others : [];
    const inner = h('div.week-inner',
      h('div.week-cols',
        mosqueLine(w, 'makkah'),
        mosqueLine(w, 'madinah')),
      others.length
        ? h('div.mosque-group.nomosque',
            h('div.mosque-head',
              h('b', '⚠ بلا مسجد'),
              h('span.small.bad', 'حدِّدْ مسجدَها لتأخذ صفَّها'),
              h('span.row.head-acts', { style: { marginInlineStart: 'auto' } })),
            h('div.week-body.lang-rows', others.flatMap(o =>
              [h('div.row.between.wrap.sm-row',
                 h('b', o.title || '—'), sermonActs(o, null, w.friday_on)),
               ...langRowsOf(o, null, w.friday_on)])))
        : null);

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
          others.length ? h('span.badge.bad', `${AR(others.length)} بلا مسجد`) : null,
          h('span.badge', { class: total ? (total >= 20 ? 'ok' : 'warn') : '' },
            total ? `${AR(total)} نسخة` : 'خالٍ'),
          h('span.badge', { class: have === 2 ? 'ok' : have ? 'warn' : 'bad' },
            have === 2 ? '✓✓' : have ? '✓' : '—'))),
      inner);
  };

  const foldAll = (mosque, shut) => {
    for (const w of weeks) setShut(w.friday_on, mosque, shut);
    drawWeeks({ reload: false });
  };

  function drawWeeks({ reload = true } = {}) {
    if (!reload) return paintWeeks();
    fill(body, h('p.muted', 'يُحمَّل…'));
    Promise.all([loadWeeks(), yearLangs.length ? null : loadLangs()])
      .then(() => { drawMonths(); paintWeeks(); });
  }

  function paintWeeks() {
    const inMonth = month ? weeks.filter(w => Number(w.h_month) === month) : weeks;
    const list = onlyShort
      ? inMonth.filter(w => !(w.makkah && w.madinah) || Number(w.langs) < 20)
      : inMonth;
    fill(body,
      occasions.length && !month
        ? h('section.card.stack',
            h('b', 'خطبٌ في غير الجُمَع'),
            h('p.small.muted', 'العيدان وعرفةُ والاستسقاءُ والكسوف — تُعرَض في مواضعها من التاريخ.'),
            h('div.stack', { style: { gap: '8px' } }, occasions.map(o =>
              h('div.stack.sm-row', { style: { gap: '4px' } },
                h('div.row.between.wrap',
                  h('b', `${o.title || '—'} — ${o.sermon_type || ''}`),
                  sermonActs(o, o.mosque || 'makkah', o.sermon_date)),
                h('div.lang-rows', ...langRowsOf(o, o.mosque || null, o.sermon_date))))))
        : null,
      month
        ? h('div.row.between.wrap.month-head',
            h('b', `الشهرُ ${monthOrder(month)} — ${monthName(month)} ${ARY(year)}هـ`),
            h('button.btn.xs.ghost', { type: 'button',
              onclick: () => { setMonth(0); drawMonths(); paintWeeks(); } }, 'كلُّ الأشهر'))
        : null,
      list.length ? h('div.weeks', list.map(weekCard))
        : emptyState(month ? 'لا جُمَعَ في هذا الشهر' : 'لا أسابيع',
            'تُحسَب جُمَعُ العام من تقويمه.'));
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
      lang: h('select', { 'aria-label': 'لغة النص' },
        h('option', { value: '' }, '—'),
        h('option', { value: 'ar' }, 'العربية (الأصل)'),
        ...langs.map(l => h('option', { value: l.code }, l.name_ar))),
      file: h('input', { type: 'file', accept: '.docx', 'aria-label': 'ملف Word' }),
      text: h('textarea', { rows: 3, 'aria-label': 'نص الخطبة',
        placeholder: 'أو الصقِ النصَّ هنا' }),
    };

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
      await reloadSections(null);
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

  // حذفُ نسخةٍ بلغتها وحدَها — يبقى صفُّها خاليًا (ملاحظة ٣٧٠)
  async function removeVersion(s, code) {
    const name = code === 'ar' ? 'العربية' : (langName(code) || code);
    if (!await confirm('حذفُ نسخة',
      `تُحذف نسخةُ «${s.title}» بـ${name} — نصُّها وملفُّها. ويبقى صفُّها خاليًا.`,
      'احذفْها', 'danger')) return;
    try {
      await db.rpc('delete_arch_version', { p_sermon: s.id, p_lang: code });
      toast('حُذفت النسخة.', 'ok');
      drawWeeks();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // حذفُ صفِّ لغةٍ من خطبة — الصفُّ لا النصّ، ويُستردُّ متى شئت
  async function hideLang(s, code) {
    const name = langName(code) || code;
    if (!await confirm('حذفُ صفِّ لغة',
      `يُحذف صفُّ ${name} من هذه الخطبة. ولا يُمَسُّ نصٌّ — ويُستردُّ الصفُّ `
      + 'من «أضِفْ صفَّ لغةٍ أخرى».', 'احذفِ الصفَّ')) return;
    try {
      await db.rpc('skip_arch_lang', { p_id: s.id, p_lang: code, p_on: true });
      drawWeeks();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // إضافةُ صفِّ لغةٍ: ما حُذف صفُّه يُردُّ، وما خرج عن لغات العام يُضاف
  async function addLangRow(s) {
    const have = new Set((s.versions || []).map(v => v.language_code));
    const shown = new Set(yearLangs.map(l => l.code)
      .filter(c => !(s.skip_langs || []).includes(c) || have.has(c)));
    const all = [{ code: 'ar', name_ar: 'العربية (الأصل)' },
      ...trLangs().filter(l => l.is_active).map(l => ({ code: l.code, name_ar: l.name_ar }))];
    const left = all.filter(l => !shown.has(l.code));
    if (!left.length) return toast('كلُّ اللغات لها صفوفُها في هذه الخطبة.', 'warn');
    const sel = h('select', { 'aria-label': 'اللغة' },
      left.map(l => h('option', { value: l.code }, l.name_ar)));
    const res = await dialog({
      title: 'صفُّ لغةٍ أخرى',
      body: h('div.stack',
        h('p.small.muted', 'يُرسَم الصفُّ خاليًا، ويُرفَع فيه متى شئت.'),
        h('label.field', 'اللغة', sel)),
      buttons: [{ label: 'أضِفْه', kind: 'primary', value: () => sel.value },
                { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('skip_arch_lang', { p_id: s.id, p_lang: res, p_on: false });
      if (!yearLangs.some(l => l.code === res)) {
        const codes = [...yearLangs.map(l => l.code), res];
        await db.rpc('set_arch_year_langs', { p_year: year, p_langs: codes })
          .catch(() => {});
        await loadLangs();
      }
      drawWeeks();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // إصدارُ خطبةٍ واحدةٍ على قالب المجمَّع
  async function bookOne(s, mosque) {
    const { rangeExportDialog } = await import('../archexport.js');
    const d = s.sermon_date || null;
    await rangeExportDialog(year, section, { from: d, to: d, mosque: mosque || s.mosque || null });
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

  // لغاتُ العام: تُحدَّد مرّةً فيُرسَم لكلٍّ منها صفٌّ (ملاحظتا ٣٦٨ و٣٧٠)
  async function yearLangsDialog() {
    const all = [{ code: 'ar', name_ar: 'العربية (الأصل)' },
      ...trLangs().filter(l => l.is_active).map(l => ({ code: l.code, name_ar: l.name_ar }))];
    const on = new Set(yearLangs.map(l => l.code));
    const boxes = all.map(l => ({ l,
      el: h('input', { type: 'checkbox', checked: on.has(l.code) ? true : null,
        disabled: l.code === 'ar' ? true : null, 'aria-label': l.name_ar }) }));
    const res = await dialog({
      title: `لغاتُ ${ARY(year)}هـ`,
      body: h('div.stack',
        h('p.small.muted', 'يُرسَم صفٌّ لكلِّ لغةٍ مختارةٍ في كلِّ خطبة، ولو لم تُرفَع بعد. '
          + 'والعربيةُ أصلٌ لا يُنزَع.'),
        h('div.check-grid', boxes.map(b =>
          h('label.check', b.el, h('span', b.l.name_ar))))),
      buttons: [{ label: 'احفظْ', kind: 'primary',
        value: () => ['ar', ...boxes.filter(b => b.el.checked && b.l.code !== 'ar')
          .map(b => b.l.code)] },
        { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('set_arch_year_langs', { p_year: year, p_langs: res });
      await loadLangs();
      drawWeeks({ reload: false });
      toast('حُفظت لغاتُ العام.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  // -------------------------------------------------------------------
  const shortBtn = h('button.btn.sm.ghost', { type: 'button' }, 'ما نقص وحدَه');
  shortBtn.onclick = () => {
    onlyShort = !onlyShort;
    shortBtn.classList.toggle('primary', onlyShort);
    shortBtn.textContent = onlyShort ? 'اعرضْ كلَّ الأسابيع' : 'ما نقص وحدَه';
    paintWeeks();
  };

  const bulkBtn = mayUpload()
    ? h('button.btn.sm', { type: 'button' }, '⇪ رفعٌ جماعي')
    : null;
  if (bulkBtn) {
    bulkBtn.onclick = async () => {
      if (!section) { toast('أضِفْ قسمًا أولًا', 'warn'); return; }
      const { importDialog } = await import('../archimport.js');
      await importDialog({
        sectionId: section.id, year,
        onDone: () => reloadSections(null),
      });
    };
  }

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
      onclick: () => { ['week', ...Object.keys(MOSQUE)].forEach(k => foldAll(k, false)); } }, 'افتحِ الكلَّ'),
    mayUpload()
      ? h('button.btn.xs', { type: 'button', onclick: () => yearLangsDialog() }, '🌐 لغاتُ العام')
      : null);

  const carryBtn = mayCarry()
    ? h('button.btn.sm', { type: 'button', title: 'نقلُ أعمال العام المنجَزة إلى الأرشيف' },
        '⇄ رحِّلْ من أرشيف الترجمة')
    : null;
  if (carryBtn) {
    carryBtn.onclick = () => busy(carryBtn, async () => {
      const { carryDialog } = await import('../archcarry.js');
      await carryDialog(year, section, { onDone: () => reloadSections(null) });
    });
  }

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

  // تصديرٌ جماعيٌّ بمدًى ولغةٍ ومسجد (ملاحظة ٣٧١)
  const expBtn = mayExport()
    ? h('button.btn.sm', { type: 'button',
        title: 'Word أو PDF على الكليشة أو على قالب — بمدًى ولغةٍ ومسجد' }, '⤓ تصديرٌ بمدى')
    : null;
  if (expBtn) {
    expBtn.onclick = () => busy(expBtn, async () => {
      const { rangeExportDialog } = await import('../archexport.js');
      await rangeExportDialog(year, section);
    });
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
        bookBtn, expBtn, bulkBtn, carryBtn, numBtn, shortBtn,
        mayUpload()
          ? h('button.btn.sm', { type: 'button',
              onclick: () => sermonDialog(null, {}) }, '＋ خطبة')
          : null,
        h('a.btn.sm.ghost', { href: '/app/sermons' }, 'كلُّ الأعوام')),
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', `خطبُ عام ${ARY(year)}هـ`),
        h('p.muted', 'العامُ اثنا عشر شهرًا، وفي الشهر جُمَعُه، وفي الجمعة خطبتا '
          + 'الحرمين، ولكلِّ خطبةٍ صفٌّ بكلِّ لغة. والغائبُ يبقى موسومًا فيُبصَر الناقص.'))),
    secBar,
    monthBar,
    foldBar,
    body);
}
