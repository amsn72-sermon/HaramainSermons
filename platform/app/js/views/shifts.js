// الحضور والانصراف: ورديات المرشدين المكانيين في مواقع الحرمين،
// وبصمة الحضور من جوال المرشد، وتقرير شهري على كليشة الهيئة (ملاحظة ١١٧)
import { h, toast, busy, confirm, dialog, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin } from '../store.js';
import { SHIFT_STATUS, hhmm, lateText, DAY_NAMES, weekStart, addDays, today, monthLabel, monthStart, thisMonth } from '../pay.js';
import { exportExcel, exportPdf } from '../teamexport.js';

const SPOTS = ['المسجد الحرام — المسعى', 'المسجد الحرام — صحن المطاف', 'المسجد الحرام — التوسعة',
  'المسجد النبوي — باب السلام', 'المسجد النبوي — الساحات', 'مكتب الإرشاد'];

export async function render(ctx) {
  const want = ['today', 'month'].includes(ctx.query?.get('tab')) ? ctx.query.get('tab') : 'week';

  let members = [];
  try {
    const rows = await db.rpc('shift_candidates');
    members = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, id: r.member_id }));
  } catch {
    members = (await db.select('profiles', {
      select: 'id,full_name,member_no,track,status', status: 'eq.active', order: 'full_name.asc'
    })).map(m => ({ ...m, member_id: m.id, is_field: m.track === 'field' }));
  }
  const fieldOnly = members.filter(m => m.is_field);

  const panel = h('div.staff-panel');
  const TABS = [['week', 'الجدول الأسبوعي'], ['today', 'حضور اليوم'], ['month', 'تقرير الشهر']];
  const btns = TABS.map(([key, label]) => {
    const b = h('button.btn.tab', { type: 'button', role: 'tab' }, label);
    b.onclick = () => show(key);
    return b;
  });

  async function show(key) {
    btns.forEach((b, i) => {
      const on = TABS[i][0] === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    history.replaceState(null, '', key === 'week' ? '/app/shifts' : `/app/shifts?tab=${key}`);
    panel.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    try {
      panel.replaceChildren(key === 'week' ? await weekSection(members)
        : key === 'today' ? await todaySection()
        : await monthSection());
    } catch (err) { panel.replaceChildren(h('p.small.bad', err.message)); }
  }

  const view = h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', 'الحضور والانصراف'),
      h('p.muted', 'ورديات المرشدين المكانيين ومواقعهم، يسجّل المرشد حضوره وانصرافه من جواله في يوم ورديته، ويُحتسب التأخير والغياب في تقرير الشهر.'))),
    h('div.tabs', { role: 'tablist' }, btns),
    panel);
  if (!members.length) {
    panel.replaceChildren(h('div.empty', h('b', 'لا أعضاء مفعّلين'),
      h('span', 'فعّل أعضاء الفريق أولًا، ثم اجدول ورديّاتهم هنا.')));
    return view;
  }
  await show(want);
  return view;
}

// ---------------------------------------------------------------------
// الجدول الأسبوعي: صفوف المرشدين وأعمدة أيام الأسبوع
// ---------------------------------------------------------------------
async function weekSection(members) {
  const box = h('div.stack');
  let from = weekStart(today());

  const grid = h('div.stack');
  const label = h('b');
  const prev = h('button.btn.sm', { type: 'button' }, '→ الأسبوع السابق');
  const next = h('button.btn.sm', { type: 'button' }, 'الأسبوع التالي ←');
  const now = h('button.btn.sm.ghost', { type: 'button' }, 'هذا الأسبوع');
  prev.onclick = () => { from = addDays(from, -7); load(); };
  next.onclick = () => { from = addDays(from, 7); load(); };
  now.onclick = () => { from = weekStart(today()); load(); };

  async function load() {
    grid.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    const to = addDays(from, 6);
    label.textContent = `${fmtDate(from)} — ${fmtDate(to)}`;
    const rows = await db.select('shifts', {
      select: '*', and: `(shift_date.gte.${from},shift_date.lte.${to})`, order: 'start_at.asc'
    }).catch(() => []);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const at = (member, day) => rows.filter(r => r.member_id === member && r.shift_date === day);

    // الصفوف: المرشدون، ومن جُدولت له وردية هذا الأسبوع ولو من غيرهم (ملاحظة ١٢٧)
    const withShift = new Set(rows.map(r => r.member_id));
    const shown = members.filter(m => m.is_field || withShift.has(m.id));
    grid.replaceChildren(h('div.table-wrap', h('table.week-grid',
      h('thead', h('tr', h('th', 'المرشد'),
        days.map(d => h('th', h('span', DAY_NAMES[new Date(`${d}T00:00:00`).getDay()]),
          h('div.small.muted', d.slice(5).replace('-', '/')),
          d === today() ? h('span.badge.gold', 'اليوم') : null)))),
      h('tbody', shown.map(m => h('tr',
        h('th.who', h('b', m.full_name), h('div.small.muted', m.member_no || '—')),
        days.map(d => h('td.day',
          at(m.id, d).map(s => chip(s, load)),
          isAdmin() ? h('button.btn.xs.ghost.add', {
            type: 'button', 'aria-label': `إضافة وردية لـ${m.full_name} يوم ${d}`,
            onclick: () => edit({ member_id: m.id, shift_date: d }, members, load)
          }, '+') : null))))))));
  }

  box.append(
    h('div.card.stack',
      h('div.row.wrap', prev, now, next, h('div.grow'), label,
        isAdmin() ? h('button.btn.sm.primary', { type: 'button', onclick: () => edit({ shift_date: today() }, members, load) }, 'وردية جديدة') : null),
      h('p.small.muted', 'اضغط على وردية لتعديلها أو حذفها، وعلى «+» لإضافة وردية في يوم المرشد.')),
    grid);
  await load();
  return box;
}

function chip(s, reload) {
  const [label, kind] = SHIFT_STATUS[s.status] || [s.status, ''];
  const el = h('button.btn.xs.shift-chip', { type: 'button', class: `st-${s.status}`,
    title: [s.location, label, s.late_minutes ? 'تأخّر ' + lateText(s.late_minutes) : null].filter(Boolean).join(' · ') },
    h('b', `${hhmm(s.start_at)}–${hhmm(s.end_at)}`),
    s.location ? h('span.small', s.location) : null,
    h('span.badge', { class: kind }, label));
  el.onclick = () => view(s, reload);
  return el;
}

async function view(s, reload) {
  const [label] = SHIFT_STATUS[s.status] || [s.status];
  const mates = s.crew_id
    ? await db.select('shifts', { select: 'member_id,is_lead,member:profiles(full_name)', crew_id: `eq.${s.crew_id}` }).catch(() => [])
    : [];
  const lead = mates.find(x => x.is_lead);
  const body = h('div.stack',
    h('p', `${hhmm(s.start_at)} — ${hhmm(s.end_at)}`, s.location ? ` · ${s.location}` : ''),
    mates.length > 1 ? h('p.small',
      h('b', 'مسؤول الوردية: '), (lead?.member?.full_name || '—'),
      h('div.small.muted', 'ومعه: ' + mates.filter(x => !x.is_lead).map(x => x.member?.full_name || '—').join('، '))) : null,
    h('p.small.muted', `الحالة: ${label}`
      + (s.check_in_at ? ` · حضر ${fmtDateTime(s.check_in_at)}` : '')
      + (s.check_out_at ? ` · انصرف ${fmtDateTime(s.check_out_at)}` : '')
      + (s.late_minutes ? ` · تأخّر ${lateText(s.late_minutes)}` : '')),
    s.note ? h('p.small', s.note) : null);
  const choice = await dialog({
    title: 'الوردية',
    body,
    buttons: isAdmin()
      ? [{ label: 'تعديل', kind: 'primary', value: 'edit' }, { label: 'تعليم غياب', value: 'absent' },
         { label: 'تعليم إجازة', value: 'leave' }, { label: 'حذف', kind: 'danger', value: 'delete' },
         { label: 'إغلاق', value: null }]
      : [{ label: 'إغلاق', value: null }]
  });
  if (!choice) return;
  if (choice === 'edit') return edit(s, null, reload);
  if (choice === 'delete') {
    const crewWide = !!s.crew_id;
    if (!await confirm('حذف الوردية',
      crewWide ? 'تُحذف الوردية من الجدول عن مسؤولها وأعضائها جميعًا.' : 'تُحذف الوردية من الجدول.',
      'حذف', 'danger')) return;
    if (crewWide) await db.rpc('delete_shift_crew', { p_crew: s.crew_id });
    else await db.rpc('delete_shift', { p_id: s.id });
    toast('حُذفت الوردية', 'ok');
    return reload();
  }
  await db.rpc('set_shift_status', { p_id: s.id, p_status: choice, p_note: null });
  toast(choice === 'absent' ? 'عُلّمت غيابًا' : 'عُلّمت إجازة', 'ok');
  return reload();
}

async function edit(s, members, reload) {
  let list = members;
  if (!list || !list.length) {
    try {
      const rows = await db.rpc('shift_candidates');
      list = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, id: r.member_id }));
    } catch {
      list = (await db.select('profiles', { select: 'id,full_name,track,status', status: 'eq.active', order: 'full_name.asc' }))
        .map(m => ({ ...m, is_field: m.track === 'field' }));
    }
  }
  if (!list.length) return toast('لا أعضاء مفعّلين لجدولة وردية', 'bad');

  // صفوف الوردية القائمة، ليُعرف مسؤولها وأعضاؤها عند التعديل
  let crew = [];
  if (s.crew_id) {
    crew = await db.select('shifts', { select: 'member_id,is_lead', crew_id: `eq.${s.crew_id}` }).catch(() => []);
  } else if (s.id) {
    crew = [{ member_id: s.member_id, is_lead: true }];
  }
  const leadId = (crew.find(c => c.is_lead) || {}).member_id || s.member_id || (list[0] && list[0].id);
  const picked = new Set(crew.filter(c => !c.is_lead).map(c => c.member_id));

  const label = m => `${m.full_name}${m.is_field ? '' : ' — من خارج الإرشاد'}`;
  const who = h('select', { 'aria-label': 'مسؤول الوردية' }, list.map(m => h('option', { value: m.id }, label(m))));
  who.value = leadId || '';

  const crewBox = h('div.pick-list');
  const counter = h('span.small.muted');
  const paintCrew = () => {
    counter.textContent = picked.size ? `معه ${picked.size} من الفريق` : 'لا أحد معه — وردية فردية';
    crewBox.replaceChildren(...list.filter(m => m.id !== who.value).map(m => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(m.id) ? true : null });
      cb.onchange = () => { cb.checked ? picked.add(m.id) : picked.delete(m.id); paintCrew(); };
      return h('label.check', cb, h('span', label(m)));
    }));
  };
  who.addEventListener('change', () => { picked.delete(who.value); paintCrew(); });
  paintCrew();

  const date = h('input', { type: 'date', value: s.shift_date || today(), 'aria-label': 'التاريخ' });
  const start = h('input', { type: 'time', value: hhmm(s.start_at) || '08:00', 'aria-label': 'من' });
  const end = h('input', { type: 'time', value: hhmm(s.end_at) || '14:00', 'aria-label': 'إلى' });
  const spot = h('input', { list: 'hs-spots', value: s.location || '', maxlength: 140, placeholder: 'الموقع داخل الحرم', 'aria-label': 'الموقع' });
  const note = h('input', { value: s.note || '', maxlength: 200, 'aria-label': 'ملاحظة' });

  const ok = await dialog({
    title: s.id || s.crew_id ? 'تعديل وردية' : 'وردية جديدة',
    body: h('div.stack',
      h('label.field', 'مسؤول الوردية', who,
        h('small', 'المرشدون المكانيون أولًا، ويجوز أن يكون المسؤول من خارجهم.')),
      h('div.row.wrap', h('label.field', 'التاريخ', date), h('label.field', 'من', start), h('label.field', 'إلى', end)),
      h('label.field', 'الموقع', spot,
        h('datalist#hs-spots', SPOTS.map(v => h('option', { value: v })))),
      h('fieldset', h('legend', 'أعضاء الوردية معه '), counter, crewBox),
      h('label.field', 'ملاحظة', note)),
    buttons: [
      { label: 'حفظ', kind: 'primary', value: true,
        validate: () => {
          if (!who.value || !date.value || !start.value || !end.value) { toast('أكمل بيانات الوردية', 'bad'); return false; }
          if (end.value <= start.value) { toast('نهاية الوردية بعد بدايتها', 'bad'); return false; }
          return true;
        } },
      { label: 'إلغاء', value: false }]
  });
  if (!ok) return;
  try {
    await db.rpc('save_shift_crew', {
      p_lead: who.value, p_members: [...picked], p_date: date.value,
      p_start: start.value, p_end: end.value,
      p_location: spot.value || null, p_note: note.value || null,
      p_crew: s.crew_id || null
    });
    toast(picked.size ? `حُفظت الوردية لـ${picked.size + 1} أعضاء` : 'حُفظت الوردية', 'ok');
    await reload();
  } catch (err) {
    toast(/duplicate|unique/i.test(err.message) ? 'لأحد المختارين وردية بالوقت نفسه في هذا اليوم' : err.message, 'bad');
  }
}

// ---------------------------------------------------------------------
// حضور اليوم
// ---------------------------------------------------------------------
async function todaySection() {
  const box = h('div.stack');
  async function load() {
    const rows = await db.select('shifts', {
      select: '*,member:profiles(id,full_name,member_no)', shift_date: `eq.${today()}`, order: 'start_at.asc'
    }).catch(() => []);
    if (!rows.length) {
      box.replaceChildren(h('div.empty', h('b', 'لا ورديات اليوم'), h('span', 'اجدول الورديات من تبويب «الجدول الأسبوعي».')));
      return;
    }
    const mark = (btn, s, status) => busy(btn, async () => {
      await db.rpc('set_shift_status', { p_id: s.id, p_status: status, p_note: null });
      await load();
    });
    box.replaceChildren(
      h('div.card.stack',
        h('h3', `ورديات ${fmtDate(today())}`),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['المرشد', 'الوردية', 'الموقع', 'الحضور', 'الانصراف', 'التأخير', 'الحالة', ''].map(t => h('th', t)))),
          h('tbody', rows.map(s => {
            const [label, kind] = SHIFT_STATUS[s.status] || [s.status, ''];
            const absent = h('button.btn.xs', { type: 'button' }, 'غياب');
            const leave = h('button.btn.xs', { type: 'button' }, 'إجازة');
            absent.onclick = () => mark(absent, s, 'absent');
            leave.onclick = () => mark(leave, s, 'leave');
            return h('tr',
              h('td', { 'data-label': 'المرشد' }, h('b', s.member?.full_name || '—'), h('div.small.muted', s.member?.member_no || '')),
              h('td', { 'data-label': 'الوردية' }, `${hhmm(s.start_at)}–${hhmm(s.end_at)}`),
              h('td', { 'data-label': 'الموقع' }, s.location || '—'),
              h('td', { 'data-label': 'الحضور' }, s.check_in_at ? fmtDateTime(s.check_in_at) : '—'),
              h('td', { 'data-label': 'الانصراف' }, s.check_out_at ? fmtDateTime(s.check_out_at) : '—'),
              h('td', { 'data-label': 'التأخير' }, s.late_minutes ? h('span.badge.warn', lateText(s.late_minutes)) : '—'),
              h('td', { 'data-label': 'الحالة' }, h('span.badge', { class: kind }, label)),
              h('td', { 'data-label': '' }, isAdmin() ? h('div.row', absent, leave) : null));
          }))))));
  }
  await load();
  return box;
}

// ---------------------------------------------------------------------
// تقرير الشهر
// ---------------------------------------------------------------------
async function monthSection() {
  const box = h('div.stack');
  const month = h('input', { type: 'month', value: thisMonth(), 'aria-label': 'شهر التقرير' });
  const body = h('div.stack');
  month.onchange = () => load();

  async function load() {
    body.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    const period = monthStart(month.value);
    const rows = await db.rpc('attendance_summary', { p_month: period }).catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      body.replaceChildren(h('div.empty', h('b', 'لا ورديات في هذا الشهر')));
      return;
    }
    const sheetRows = () => [
      ['المرشد', 'الورديات', 'حضور', 'غياب', 'إجازات', 'دقائق التأخير'],
      ...list.map(r => [r.full_name, String(r.shifts), String(r.present), String(r.absent), String(r.leaves), String(r.late_minutes)]),
      ['الإجمالي',
        String(list.reduce((s, r) => s + r.shifts, 0)), String(list.reduce((s, r) => s + r.present, 0)),
        String(list.reduce((s, r) => s + r.absent, 0)), String(list.reduce((s, r) => s + r.leaves, 0)),
        String(list.reduce((s, r) => s + r.late_minutes, 0))]
    ];
    const title = `تقرير الحضور — ${monthLabel(period)}`;
    body.replaceChildren(h('div.card.stack',
      h('div.row.between.wrap', h('h3', title),
        h('div.row',
          h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheetRows(), title) }, 'تصدير Excel'),
          h('button.btn.sm', { type: 'button',
            onclick: () => { if (!exportPdf(sheetRows(), title, { note: `عدد المرشدين: ${list.length} — ${fmtDate(new Date())}` })) toast('اسمح بالنوافذ المنبثقة لتصدير التقرير', 'bad'); } },
            'تقرير PDF على الكليشة'))),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['المرشد', 'الورديات', 'حضور', 'غياب', 'إجازات', 'التأخير'].map(t => h('th', t)))),
        h('tbody', list.map(r => h('tr',
          h('td', { 'data-label': 'المرشد' }, r.full_name),
          h('td', { 'data-label': 'الورديات' }, String(r.shifts)),
          h('td', { 'data-label': 'حضور' }, String(r.present)),
          h('td', { 'data-label': 'غياب' }, r.absent ? h('span.badge.bad', String(r.absent)) : '0'),
          h('td', { 'data-label': 'إجازات' }, String(r.leaves)),
          h('td', { 'data-label': 'التأخير' }, r.late_minutes ? h('span.badge.warn', lateText(r.late_minutes)) : 'في الوقت'))))))));
  }

  box.append(h('div.card.stack', h('div.row.wrap', h('label.field', 'الشهر', month))), body);
  await load();
  return box;
}
