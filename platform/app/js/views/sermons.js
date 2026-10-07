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
import { state, MOSQUE, SERMON_TYPES, langName, trLangs, isManager, can } from '../store.js';
import { typeIcon } from '../icons.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA');
const ARY = n => Number(n || 0).toLocaleString('ar-SA', { useGrouping: false });
const MOSQUE_ICON = { makkah: '🕋', madinah: '🕌' };

const mayUpload = () => isManager() || can('arch_upload');
const mayEdit   = () => isManager() || can('arch_edit');
const mayExport = () => isManager() || can('arch_export');

// أيقوناتُ صفِّ الخطبة — على نسق أرشيف أعمال الترجمة (ملاحظة ٣٠٣)
const ICONS = {
  open:  '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
  langs: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  edit:  '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M14 6l4 4"/>',
  down:  '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/>',
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

  const grid = h('div.year-grid');
  const draw = () => {
    fill(grid, ...(tiles.length ? tiles.map(t =>
      h('a.year-tile', { href: `/app/sermons/${t.h_year}` },
        h('b.year-no', ARY(t.h_year)),
        h('span.year-h', 'هـ'),
        h('div.year-meta',
          h('span', `${AR(t.sermons)} خطبة`),
          h('span', `${AR(t.versions)} نسخة`),
          h('span', `${AR(t.langs)} لغة`))))
      : [emptyState('لا أعوام بعد', 'أضِفْ عامًا لتبدأ الأرشفة.')]));
  };
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
      mayUpload()
        ? h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
            h('button.btn.sm.primary', { type: 'button', onclick: addYear }, '＋ عام'))
        : null,
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

  // صفُّ الخطبة — على نسق أرشيف أعمال الترجمة
  const sermonRow = (s, mosque, friday) => {
    if (!s) {
      return h('div.row.between.wrap.sm-row.empty',
        h('span.small.muted', `${MOSQUE_ICON[mosque]} ${MOSQUE[mosque]} — لم تُضَف`),
        mayUpload()
          ? h('button.btn.xs', { type: 'button',
              onclick: () => sermonDialog(null, { mosque, friday }) }, '⤒ ارفعْ')
          : null);
    }
    const n = Number(s.n_langs || 0);
    return h('div.stack.sm-row', { style: { gap: '4px' } },
      h('div.row.between.wrap',
        h('div', { style: { flex: 1, minWidth: '240px' } },
          h('span.sm-no', AR(s.seq || 0)),
          h('b', `${MOSQUE_ICON[mosque]} ${s.sermon_type} من ${MOSQUE[mosque]}`),
          h('b.sm-title', ` (${s.title})`),
          h('div.small.muted',
            [s.khateeb, s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : null),
             s.sermon_date ? fmtDate(s.sermon_date) : null].filter(Boolean).join('، '))),
        h('div.row', { style: { gap: '4px' } },
          h('span.badge', { class: n >= 10 ? 'ok' : n ? 'warn' : 'bad' },
            n ? `${AR(n)} لغة` : 'بلا نسخ'),
          h('button.icon-btn', { type: 'button', title: 'اعرضِ الخطبةَ ونسخَها',
            onclick: () => openSermon(s.id) }, ico('open')),
          mayEdit()
            ? h('button.icon-btn', { type: 'button', title: 'تعديل',
                onclick: () => sermonDialog(s.id, { mosque, friday }) }, ico('edit'))
            : null,
          mayExport()
            ? h('button.icon-btn', { type: 'button', title: 'تنزيلُ الخطبة',
                onclick: () => openSermon(s.id) }, ico('down'))
            : null,
          mayEdit()
            ? h('button.icon-btn.danger', { type: 'button', title: 'حذف',
                onclick: () => removeSermon(s) }, ico('trash'))
            : null)),
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
      const all = ['ar', ...trLangs().filter(l => l.is_active).map(l => l.code)];
      fill(box, ...all.map(code => {
        const on = has.has(code);
        const b = h('button.lang-chip' + (on ? '.on' : ''), { type: 'button',
          title: on ? 'افتحْها' : 'ارفعْ نسختَها' },
          code === 'ar' ? 'العربية (الأصل)' : langName(code));
        b.onclick = () => (on ? openSermon(id, code)
          : mayUpload() ? addVersion(id, code) : toast('هذا خارجَ نطاقِ عملك الحالي.', 'bad'));
        return b;
      }), mayUpload()
        ? h('button.lang-chip.add', { type: 'button', onclick: () => addVersion(id, null) }, '＋ لغة')
        : null);
    };
    if (n) paint(); else box.append(h('span.small.muted', 'لا نسخَ بعد'));
    return box;
  };

  const weekCard = w => {
    const total = Number(w.langs || 0);
    const have = (w.makkah ? 1 : 0) + (w.madinah ? 1 : 0);
    return h('section.week-card',
      h('div.week-head',
        h('b', `الأسبوع ${AR(w.week_no)}`),
        h('span.small.muted', `الجمعة ${fmtHijri(w.friday_on)} — ${fmtDate(w.friday_on)}`),
        h('span.row', { style: { gap: '6px', marginInlineStart: 'auto' } },
          h('span.badge', { class: total ? (total >= 20 ? 'ok' : 'warn') : '' },
            total ? `${AR(total)} نسخة` : 'خالٍ'),
          h('span.badge', { class: have === 2 ? 'ok' : have ? 'warn' : 'bad' },
            have === 2 ? '✓✓' : have ? '✓' : '—'))),
      h('div.week-body',
        sermonRow(w.makkah, 'makkah', w.friday_on),
        sermonRow(w.madinah, 'madinah', w.friday_on)));
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
    const f = {
      title: h('input', { value: cur.title || '', 'aria-label': 'موضوع الخطبة' }),
      khateeb: h('input', { value: cur.khateeb || '', 'aria-label': 'الخطيب' }),
      date: h('input', { type: 'date',
        value: cur.sermon_date || (friday ? String(friday).slice(0, 10) : ''),
        'aria-label': 'تاريخ الخطبة' }),
      hijri: h('input', { value: cur.hijri_text || '', 'aria-label': 'التاريخ الهجري',
        placeholder: '٧ محرّم ١٤٤٦هـ' }),
      mosque: h('select', { 'aria-label': 'المسجد' },
        Object.entries(MOSQUE).map(([k, v]) =>
          h('option', { value: k, selected: (cur.mosque || mosque) === k }, v))),
      type: h('select', { 'aria-label': 'نوع الخطبة' },
        SERMON_TYPES.map(t => h('option', { value: t,
          selected: (cur.sermon_type || 'خطبة جمعة') === t }, t))),
      notes: h('textarea', { rows: 2, 'aria-label': 'ملاحظة' }, cur.notes || '')
    };
    const hint = h('p.small.muted');
    const syncHint = () => {
      hint.textContent = f.date.value
        ? `بالهجري: ${fmtHijri(f.date.value)} — وتُنسَب إلى جمعة ${fmtDate(f.date.value)}`
        : '';
    };
    f.date.oninput = syncHint; syncHint();

    const res = await dialog({
      title: id ? 'تعديلُ خطبة' : 'إضافةُ خطبة',
      body: h('div.stack',
        h('label.field', 'موضوع الخطبة', f.title),
        h('div.grid-2',
          h('label.field', 'الخطيب', f.khateeb),
          h('label.field', 'المسجد', f.mosque),
          h('label.field', 'نوع الخطبة', f.type),
          h('label.field', 'تاريخ الخطبة', f.date)),
        hint,
        h('label.field', 'التاريخ الهجري كما يُكتب', f.hijri,
          h('small', 'يُطبَع في صفحة عنوانها بالمجمَّع — يُترك فارغًا فيُحسَب')),
        h('label.field', 'ملاحظة', f.notes)),
      buttons: [{ label: 'حفظ', kind: 'primary',
        validate: () => (f.title.value.trim() ? true : 'اكتب موضوعَ الخطبة'),
        value: () => ({
          id: id || null, section_id: section?.id,
          title: f.title.value.trim(), khateeb: f.khateeb.value.trim() || null,
          mosque: f.mosque.value, sermon_type: f.type.value,
          sermon_date: f.date.value || null, hijri_text: f.hijri.value.trim() || null,
          notes: f.notes.value.trim() || null, versions: []
        }) }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('save_arch_sermon', { p: res });
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
    let path = null;
    file.onchange = () => busy(file, async () => {
      const fl = file.files[0]; if (!fl) return;
      try {
        const safe = String(fl.name).replace(/[^\w.\-]+/g, '_');
        path = `${id}/${Date.now()}_${safe}`;
        await storage.upload('repo', path, fl);
        note.textContent = 'رُفع الملف.';
      } catch (e) { note.textContent = e.message; path = null; }
    });

    const res = await dialog({
      title: 'نسخةٌ بلغة',
      body: h('div.stack',
        h('p.small.muted', 'النصُّ يُبنى به المجمَّعُ السنوي، والملفُّ يُحفَظ معه ويُنزَّل.'),
        h('label.field', 'اللغة', lang),
        h('label.field', 'ملفُّ النسخة (PDF أو وورد)', file, note),
        h('label.field', 'النصّ', text)),
      buttons: [{ label: 'حفظ', kind: 'primary',
        value: () => ({ language_code: lang.value, body_html: text.value.trim() || null,
          file_path: path, is_source: lang.value === 'ar' }) }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('save_arch_sermon', { p: { id, section_id: section?.id,
        title: '—', versions: [res] } });
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
        bookBtn, bulkBtn, shortBtn,
        mayUpload()
          ? h('button.btn.sm', { type: 'button',
              onclick: () => sermonDialog(null, {}) }, '＋ خطبة')
          : null,
        h('a.btn.sm.ghost', { href: '/app/sermons' }, 'كلُّ الأعوام')),
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', `خطبُ عام ${ARY(year)}هـ`),
        h('p.muted', 'أسابيعُ الجُمَع: في كلِّ أسبوعٍ خطبتان، ولكلِّ خطبةٍ لغاتُها. '
          + 'والغائبُ يبقى صفًّا موسومًا فيُبصَر الناقص.'))),
    secBar,
    body);
}
