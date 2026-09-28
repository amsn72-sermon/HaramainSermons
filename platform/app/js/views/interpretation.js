// سجلّ الترجمة الفورية: ساعاتٌ تُدوَّن بعد إتمامها، لا نصَّ لها ولا تسجيل (ملاحظة ١٤٧)
import { h, fill, dialog, toast, busy, fmtSermonDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { state, langName, isAdmin, MOSQUE } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';

export const EVENT_TYPES = ['درس علمي', 'مؤتمر', 'ندوة', 'أخرى'];
const VENUE = { makkah: MOSQUE.makkah, madinah: MOSQUE.madinah, other: 'مكان آخر' };
const ar = n => Number(n || 0).toLocaleString('en-US');
const hrs = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US');
const venueOf = r => (r.venue === 'other' ? (r.venue_note || 'مكان آخر') : VENUE[r.venue] || '—');

// شهر ميلادي على هيئة YYYY-MM
const monthOf = d => String(d || '').slice(0, 7);

export async function load() {
  const [rows, members] = await Promise.all([
    db.select('interpretations', { select: '*', order: 'held_on.desc' }),
    db.select('profiles', { select: 'id,full_name,role,status,track', status: 'eq.active', order: 'full_name' })
  ]);
  const langRows = await db.select('member_languages', { select: 'member_id,language_code' }).catch(() => []);
  const byMember = new Map();
  for (const l of langRows) {
    if (!byMember.has(l.member_id)) byMember.set(l.member_id, []);
    byMember.get(l.member_id).push(l.language_code);
  }
  return { rows, members, byMember };
}

// نافذة الإدخال والتعديل: البيانات التي يشهد بها المشرف
export function entryDialog({ members, byMember }, row = null) {
  const f = {
    member: h('select', { 'aria-label': 'المترجم' },
      h('option', { value: '' }, '— اختر المترجم —'),
      members.filter(m => m.role !== 'supervisor')
        .map(m => h('option', { value: m.id, selected: row?.member_id === m.id }, m.full_name))),
    lang: h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, '— اختر اللغة —')),
    date: h('input', { type: 'date', value: row?.held_on || '', 'aria-label': 'تاريخ الفعالية' }),
    hours: h('input', { type: 'number', min: '0.25', max: '24', step: '0.25',
      value: row?.hours ?? '', 'aria-label': 'عدد الساعات' }),
    type: h('select', { 'aria-label': 'نوع الفعالية' },
      EVENT_TYPES.map(t => h('option', { value: t, selected: row?.event_type === t }, t))),
    venue: h('select', { 'aria-label': 'المكان' },
      Object.entries(VENUE).map(([k, v]) => h('option', { value: k, selected: row?.venue === k }, v))),
    venueNote: h('input', { value: row?.venue_note || '', 'aria-label': 'اسم المكان' }),
    title: h('input', { value: row?.title || '', 'aria-label': 'عنوان الفعالية' }),
    speaker: h('input', { value: row?.speaker || '', 'aria-label': 'الملقي' }),
    url: h('input', { value: row?.youtube_url || '', dir: 'ltr', placeholder: 'https://…', 'aria-label': 'رابط النشر' }),
    note: h('textarea', { rows: 2, 'aria-label': 'ملاحظة' }, row?.note || '')
  };

  // لغات المترجم وحدها تُعرض، فلا تُسجَّل ساعةٌ بلغةٍ ليست له
  const fillLangs = () => {
    const codes = byMember.get(f.member.value) || [];
    fill(f.lang, h('option', { value: '' }, codes.length ? '— اختر اللغة —' : '— لا لغات مقيَّدة —'),
      codes.map(c => h('option', { value: c, selected: row?.language_code === c }, langName(c))));
  };
  f.member.onchange = fillLangs;
  fillLangs();

  const venueWrap = h('label.field', 'اسم المكان', f.venueNote);
  const syncVenue = () => { venueWrap.hidden = f.venue.value !== 'other'; };
  f.venue.onchange = syncVenue; syncVenue();

  const bad = [];
  const body = h('div.stack',
    h('p.small.muted', 'تُدوَّن الساعة بعد إتمام الترجمة الفورية، بشهادة مشرف الهيئة على إنجازها.'),
    h('div.grid-2',
      h('label.field', req('المترجم'), f.member),
      h('label.field', req('اللغة'), f.lang),
      h('label.field', req('تاريخ الفعالية'), f.date),
      h('label.field', req('عدد الساعات'), f.hours),
      h('label.field', 'نوع الفعالية', f.type),
      h('label.field', 'المكان', f.venue)),
    venueWrap,
    h('label.field', req('عنوان الفعالية'), f.title),
    h('div.grid-2',
      h('label.field', 'الملقي (اختياري)', f.speaker),
      h('label.field', 'رابط النشر على يوتيوب (اختياري)', f.url)),
    h('label.field', 'ملاحظة', f.note));

  const validate = () => {
    bad.forEach(el => markBad(el, false)); bad.length = 0;
    const need = (el, cond, msg) => { if (cond) { bad.push(el); markBad(el, true); return msg; } return null; };
    const errs = [
      need(f.member, !f.member.value, 'اختر المترجم'),
      need(f.lang, !f.lang.value, 'اختر اللغة'),
      need(f.date, !f.date.value, 'حدّد تاريخ الفعالية'),
      need(f.hours, !(Number(f.hours.value) > 0), 'اكتب عدد الساعات'),
      need(f.hours, Number(f.hours.value) > 24, 'الساعات لا تتجاوز ٢٤ في اليوم'),
      need(f.title, !f.title.value.trim(), 'اكتب عنوان الفعالية'),
      need(f.venueNote, f.venue.value === 'other' && !f.venueNote.value.trim(), 'اكتب اسم المكان')
    ].filter(Boolean);
    return errs.length ? errs[0] : true;
  };

  return dialog({
    title: row ? 'تعديل ساعة ترجمة فورية' : 'تدوين ترجمة فورية',
    body,
    buttons: [
      { label: 'إلغاء', value: null },
      { label: 'حفظ', kind: 'primary', validate, value: () => ({
        id: row?.id || null, member_id: f.member.value, language_code: f.lang.value,
        held_on: f.date.value, hours: Number(f.hours.value), event_type: f.type.value,
        venue: f.venue.value, venue_note: f.venueNote.value.trim(), title: f.title.value.trim(),
        speaker: f.speaker.value.trim(), youtube_url: f.url.value.trim(), note: f.note.value.trim()
      }) }
    ]
  });
}

export async function render() {
  const data = await load();
  const admin = isAdmin();
  const nameOf = id => data.members.find(m => m.id === id)?.full_name || '—';

  const f = {
    month: h('input', { type: 'month', 'aria-label': 'الشهر' }),
    lang: h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'),
      state.languages.map(l => h('option', { value: l.code }, langName(l.code)))),
    member: h('select', { 'aria-label': 'المترجم' }, h('option', { value: '' }, 'كل المترجمين'),
      data.members.map(m => h('option', { value: m.id }, m.full_name))),
    type: h('select', { 'aria-label': 'نوع الفعالية' }, h('option', { value: '' }, 'كل الأنواع'),
      EVENT_TYPES.map(t => h('option', { value: t }, t)))
  };

  const match = r => (!f.month.value || monthOf(r.held_on) === f.month.value)
    && (!f.lang.value || r.language_code === f.lang.value)
    && (!f.member.value || r.member_id === f.member.value)
    && (!f.type.value || r.event_type === f.type.value);

  const table = h('div.stack');
  const totals = h('div.counter-grid');

  const reload = async () => {
    const fresh = await db.select('interpretations', { select: '*', order: 'held_on.desc' });
    data.rows = fresh; draw();
  };

  const remove = async row => {
    const ok = await dialog({ title: 'حذف السجل',
      body: h('p', `يُحذف سجلّ «${row.title}» بتاريخ ${fmtSermonDate(row.held_on)}؟`),
      buttons: [{ label: 'إلغاء', value: false }, { label: 'حذف', kind: 'bad', value: true }] });
    if (!ok) return;
    try { await db.rpc('delete_interpretation', { p_id: row.id }); toast('حُذف السجل.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const edit = async row => {
    const p = await entryDialog(data, row);
    if (!p) return;
    try { await db.rpc('save_interpretation', { p }); toast('حُفظ السجل.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  function draw() {
    const list = data.rows.filter(match);
    const hours = list.reduce((s, r) => s + Number(r.hours || 0), 0);
    const langs = new Set(list.map(r => r.language_code)).size;
    const people = new Set(list.map(r => r.member_id)).size;
    totals.replaceChildren(
      h('div.counter-main',
        h('span.counter-label', 'مجموع ساعات الترجمة الفورية'),
        h('b.counter-num', hrs(hours)),
        h('span.counter-sub', `${ar(list.length)} فعالية`)),
      h('div.counter-side',
        h('div.counter-cell', h('b', ar(people)), h('span', 'مترجمًا')),
        h('div.counter-cell', h('b', ar(langs)), h('span', 'لغة')),
        h('div.counter-cell', h('b', ar(list.filter(r => r.youtube_url).length)), h('span', 'منشورة'))));

    const head = ['التاريخ', 'الفعالية', 'النوع', 'المكان', 'المترجم', 'اللغة', 'الساعات', ...(admin ? [''] : [])];
    table.replaceChildren(h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', head.map(t => h('th', t)))),
      h('tbody', list.length ? list.map(r => h('tr',
        h('td', { 'data-label': 'التاريخ' }, fmtSermonDate(r.held_on)),
        h('td', { 'data-label': 'الفعالية' }, h('b', r.title),
          r.speaker ? h('span.small.muted', ` — ${r.speaker}`) : null,
          r.youtube_url ? h('a.small', { href: r.youtube_url, target: '_blank', rel: 'noopener',
            style: { display: 'block' } }, 'رابط النشر ↗') : null),
        h('td', { 'data-label': 'النوع' }, r.event_type),
        h('td', { 'data-label': 'المكان' }, venueOf(r)),
        h('td', { 'data-label': 'المترجم' }, nameOf(r.member_id)),
        h('td', { 'data-label': 'اللغة' }, langName(r.language_code)),
        h('td', { 'data-label': 'الساعات' }, hrs(r.hours)),
        admin ? h('td.row', { 'data-label': '' },
          h('button.btn.xs', { type: 'button', onclick: () => edit(r) }, 'تعديل'),
          h('button.btn.xs.bad', { type: 'button', onclick: () => remove(r) }, 'حذف')) : null))
        : [h('tr', h('td', { colspan: String(head.length) }, h('p.muted', 'لا ساعات مدوَّنة ضمن هذا التحديد.')))]),
      h('tfoot', h('tr.total-row',
        h('td', { colspan: '6' }, 'المجموع'),
        h('td', hrs(hours)),
        admin ? h('td', '') : null)))));

    // ملخّصان: بحسب اللغة وبحسب المترجم — يُطلبان في التقارير
    const by = (key, label) => {
      const keys = [...new Set(list.map(r => r[key]))];
      if (!keys.length) return null;
      return h('section.card.stack', h('h3', label),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', [label, 'الفعاليات', 'الساعات'].map(t => h('th', t)))),
          h('tbody', keys.map(k => {
            const l = list.filter(r => r[key] === k);
            return h('tr',
              h('td', { 'data-label': label }, key === 'language_code' ? langName(k) : (key === 'member_id' ? nameOf(k) : k)),
              h('td', { 'data-label': 'الفعاليات' }, ar(l.length)),
              h('td', { 'data-label': 'الساعات' }, hrs(l.reduce((s, r) => s + Number(r.hours || 0), 0))));
          })))));
    };
    summaries.replaceChildren(...[by('language_code', 'اللغة'), by('member_id', 'المترجم'),
      by('event_type', 'نوع الفعالية')].filter(Boolean));
  }

  const summaries = h('div.stack');
  for (const el of Object.values(f)) el.addEventListener('change', draw);

  const addBtn = admin ? h('button.btn.sm.primary', { type: 'button' }, '+ تدوين ترجمة فورية') : null;
  if (addBtn) addBtn.onclick = () => edit(null);

  // التصدير: كشف يصلح للمستخلص ولتقارير الإنجاز
  const fmtSel = h('select', { 'aria-label': 'صيغة التصدير' },
    h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
    h('option', { value: 'docx' }, 'Word على كليشة الهيئة'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
  const expBtn = h('button.btn.sm', { type: 'button' }, 'تصدير السجل');
  expBtn.onclick = () => busy(expBtn, async () => {
    const list = data.rows.filter(match);
    const out = [['التاريخ', 'الفعالية', 'النوع', 'المكان', 'الملقي', 'المترجم', 'اللغة', 'الساعات', 'رابط النشر']];
    for (const r of list) {
      out.push([r.held_on, r.title, r.event_type, venueOf(r), r.speaker || '', nameOf(r.member_id),
        langName(r.language_code), hrs(r.hours), r.youtube_url || '']);
    }
    const hours = list.reduce((s, r) => s + Number(r.hours || 0), 0);
    out.push(['المجموع', '', '', '', '', '', '', hrs(hours), '']);
    const title = 'سجلّ الترجمة الفورية';
    const note = `${ar(list.length)} فعالية · ${hrs(hours)} ساعة — الوحدة التعاقدية: الساعة`;
    try {
      if (fmtSel.value === 'xlsx') {
        downloadBlob(buildXlsx(out, { sheetName: title, allText: true }),
          `${title} ${new Date().toISOString().slice(0, 10)}.xlsx`);
      } else {
        const { exportWord, exportPdf } = await import('../teamexport.js');
        if (fmtSel.value === 'docx') await exportWord(out, title, { note });
        else if (!exportPdf(out, title, { note })) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  draw();

  return h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, fmtSel, expBtn, addBtn),
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'الترجمة الفورية'),
        h('p.muted', 'الدروس والندوات والمؤتمرات التي تُرجمت فوريًّا — وحدتها التعاقدية الساعة، ويدوّنها المنسق بعد إتمامها.'))),
    totals,
    h('div.card.stack',
      h('div.grid-2',
        h('label.field', 'الشهر', f.month),
        h('label.field', 'اللغة', f.lang),
        h('label.field', 'المترجم', f.member),
        h('label.field', 'نوع الفعالية', f.type))),
    table,
    summaries,
    h('p.small.muted', 'محتوى التسجيل ترفعه الهيئة على يوتيوب إن كان درسًا، وبعض المؤتمرات والندوات لا تُنشر — فالرابط اختياري.'));
}
