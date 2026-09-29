// قاعات الاجتماعات والتدريب: قاعةٌ مسمّاة لها جدول، ولقاءاتٌ بمدعوّيها
// ودعواتها وزرِّ انضمامها وسجلِّ حضورها (ملاحظة ١٦٣).
//   ومجرى الصوت والصورة اليوم رابطٌ خارجي (Jitsi أو غيره) يلصقه المنظِّم،
//   ويصير خيارًا داخليًّا حين يُستضاف خادم اللقاءات في الرياض.
import { h, dialog, toast, busy, confirm, fmtDateTime, fmtDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin, isManager, ROLE_LABEL } from '../store.js';

export const KINDS = ['دورة تدريبية', 'اجتماع', 'ورشة عمل', 'أخرى'];
const KIND_ICON = { 'دورة تدريبية': '🎓', 'اجتماع': '🗂', 'ورشة عمل': '🛠', 'أخرى': '📌' };

const ar = n => Number(n || 0).toLocaleString('en-US');
const mins = s => Math.round((s || 0) / 60);
// التوقيت المحلي للإدخال: قيمة datetime-local من تاريخ ISO
const toLocal = iso => {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
};

export const isOpen = m => {
  const s = new Date(m.starts_at), e = new Date(m.ends_at || s);
  const now = Date.now();
  return m.status === 'scheduled' && now >= s.getTime() - 15 * 60000 && now <= e.getTime() + 30 * 60000;
};
export const isPast = m => new Date(m.ends_at || m.starts_at).getTime() < Date.now();

export async function load() {
  const [meetings, rooms, members] = await Promise.all([
    db.select('meeting_rows', { select: '*', order: 'starts_at.desc' }).catch(() => []),
    db.select('rooms', { select: '*', order: 'sort' }).catch(() => []),
    db.select('profiles', { select: 'id,full_name,role,track,status', status: 'eq.active', order: 'full_name' })
      .catch(() => [])
  ]);
  return { meetings, rooms, members };
}

// ---------------------------------------------------------------------
// نافذة اللقاء: بياناته ومدعوّوه
// ---------------------------------------------------------------------
function meetingDialog(data, row = null) {
  const f = {
    title: h('input', { value: row?.title || '', 'aria-label': 'عنوان اللقاء' }),
    kind: h('select', { 'aria-label': 'نوع اللقاء' },
      KINDS.map(k => h('option', { value: k, selected: (row?.kind || 'اجتماع') === k }, k))),
    room: h('select', { 'aria-label': 'القاعة' }, h('option', { value: '' }, '— بلا قاعة —'),
      data.rooms.filter(r => r.is_active || r.id === row?.room_id)
        .map(r => h('option', { value: r.id, selected: row?.room_id === r.id }, `${r.name} (${r.capacity})`))),
    at: h('input', { type: 'datetime-local', 'aria-label': 'موعد اللقاء',
      value: row ? toLocal(row.starts_at) : '' }),
    minutes: h('input', { type: 'number', min: 5, max: 720, step: 5, value: row?.minutes ?? 60,
      'aria-label': 'المدة بالدقائق' }),
    url: h('input', { value: row?.join_url || '', dir: 'ltr', placeholder: 'https://meet.jit.si/…',
      'aria-label': 'رابط الانضمام' }),
    desc: h('textarea', { rows: 2, 'aria-label': 'وصف اللقاء' }, row?.description || '')
  };

  // المدعوّون: بأعيانهم أو بمجموعات جاهزة — ومشرف الهيئة منهم (ملاحظة ١٦٣)
  const picked = new Set(row?.invitees || []);
  const boxes = new Map();
  const groupOf = m => (m.role === 'supervisor' ? 'مشرفو الهيئة'
    : ['manager', 'coordinator'].includes(m.role) ? 'الحسابات الإدارية'
      : m.track === 'field' ? 'المرشدون المكانيون' : 'المترجمون المتخصصون');
  const groups = [...new Set(data.members.map(groupOf))];
  const count = h('span.badge');
  const paint = () => { count.textContent = `${picked.size} مدعوًّا`; };

  const list = h('div.stack', groups.map(g => {
    const people = data.members.filter(m => groupOf(m) === g);
    const all = h('button.btn.xs', { type: 'button' }, 'الكل');
    const none = h('button.btn.xs', { type: 'button' }, 'لا أحد');
    const rows = people.map(m => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(m.id), 'aria-label': m.full_name });
      cb.onchange = () => { cb.checked ? picked.add(m.id) : picked.delete(m.id); paint(); };
      boxes.set(m.id, cb);
      return h('label.row.inv-row', { style: { gap: '6px', alignItems: 'center' } },
        cb, h('span', m.full_name), h('span.small.muted', ROLE_LABEL[m.role] || ''));
    });
    all.onclick = () => { people.forEach(m => { picked.add(m.id); boxes.get(m.id).checked = true; }); paint(); };
    none.onclick = () => { people.forEach(m => { picked.delete(m.id); boxes.get(m.id).checked = false; }); paint(); };
    return h('div.card.stack',
      h('div.row.between', h('b', g), h('div.row', all, none)),
      h('div.inv-grid', rows));
  }));
  paint();

  const bad = [];
  const body = h('div.stack',
    h('div.grid-2',
      h('label.field', req('عنوان اللقاء'), f.title),
      h('label.field', 'النوع', f.kind),
      h('label.field', 'القاعة', f.room),
      h('label.field', req('الموعد'), f.at),
      h('label.field', req('المدة بالدقائق'), f.minutes),
      h('label.field', req('رابط الانضمام'), h('small', 'رابط الجلسة من Jitsi أو غيره'), f.url)),
    h('label.field', 'وصف اللقاء وجدول أعماله', f.desc),
    h('div.card.stack',
      h('div.row.between', h('b', 'المدعوّون'), count),
      h('p.small.muted', 'تصل الدعوة في بريد كل مدعوّ، ويظهر له زرّ الانضمام قبل الموعد بربع ساعة.'),
      list));

  const validate = () => {
    bad.forEach(el => markBad(el, false)); bad.length = 0;
    const need = (el, cond, msg) => { if (cond) { bad.push(el); markBad(el, true); return msg; } return null; };
    const errs = [
      need(f.title, !f.title.value.trim(), 'اكتب عنوان اللقاء'),
      need(f.at, !f.at.value, 'حدّد موعد اللقاء'),
      need(f.minutes, !(Number(f.minutes.value) >= 5), 'المدة خمس دقائق فأكثر'),
      need(f.url, !f.url.value.trim(), 'ألصق رابط الانضمام'),
      need(f.url, f.url.value.trim() && !/^https:\/\//i.test(f.url.value.trim()), 'الرابط يبدأ بـ https://')
    ].filter(Boolean);
    if (!errs.length && !picked.size) return 'اختر مدعوًّا واحدًا على الأقل';
    // السعة تنبيهٌ لا منع
    const room = data.rooms.find(r => r.id === f.room.value);
    if (!errs.length && room && picked.size > room.capacity) {
      toast(`المدعوّون ${picked.size} وسعة «${room.name}» ${room.capacity} — راجع القاعة أو الرابط.`, 'warn');
    }
    return errs.length ? errs[0] : true;
  };

  return dialog({
    title: row ? 'تعديل اللقاء' : 'لقاء جديد',
    body,
    buttons: [
      { label: 'إلغاء', value: null },
      { label: 'حفظ وإرسال الدعوات', kind: 'primary', validate, value: () => ({
        id: row?.id || null, title: f.title.value.trim(), kind: f.kind.value,
        room_id: f.room.value || null, starts_at: new Date(f.at.value).toISOString(),
        minutes: Number(f.minutes.value), description: f.desc.value.trim(),
        provider: 'external', join_url: f.url.value.trim(), invitees: [...picked]
      }) }
    ]
  });
}

// ---------------------------------------------------------------------
// نافذة القاعة
// ---------------------------------------------------------------------
function roomDialog(row = null) {
  const f = {
    name: h('input', { value: row?.name || '', 'aria-label': 'اسم القاعة' }),
    cap: h('input', { type: 'number', min: 2, max: 1000, value: row?.capacity ?? 25, 'aria-label': 'السعة' }),
    desc: h('input', { value: row?.description || '', 'aria-label': 'وصف القاعة' })
  };
  return dialog({
    title: row ? 'تعديل القاعة' : 'قاعة جديدة',
    body: h('div.stack',
      h('div.grid-2',
        h('label.field', req('اسم القاعة'), f.name),
        h('label.field', 'السعة', f.cap)),
      h('label.field', 'الوصف', f.desc),
      h('p.small.muted', 'القاعة اسمٌ وجدول: لا يُحجز فيها لقاءان في وقت واحد.')),
    buttons: [
      { label: 'إلغاء', value: null },
      { label: 'حفظ', kind: 'primary',
        validate: () => (f.name.value.trim() ? true : 'اكتب اسم القاعة'),
        value: () => ({ id: row?.id || null, name: f.name.value.trim(),
          capacity: Number(f.cap.value) || 25, description: f.desc.value.trim() }) }
    ]
  });
}

// ---------------------------------------------------------------------
export async function render() {
  const data = await load();
  const admin = isAdmin();
  const box = h('div.stack');
  const roomsBox = h('div.stack');

  const reload = async () => {
    const fresh = await load();
    data.meetings = fresh.meetings; data.rooms = fresh.rooms; data.members = fresh.members;
    draw();
  };

  const edit = async row => {
    let full = row;
    if (row) {
      const inv = await db.select('meeting_invitees', { select: 'member_id', meeting_id: `eq.${row.id}` })
        .catch(() => []);
      full = { ...row, invitees: inv.map(x => x.member_id) };
    }
    const p = await meetingDialog(data, full);
    if (!p) return;
    try { await db.rpc('save_meeting', { p }); toast('حُفظ اللقاء وأُرسلت الدعوات.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const join = (btn, m) => busy(btn, async () => {
    try {
      const url = await db.rpc('join_meeting', { p_id: m.id });
      const link = String(url || '').replace(/^"|"$/g, '');
      if (!link) return toast('لا رابط لهذا اللقاء — راجع المنسق.', 'bad');
      window.open(link, '_blank', 'noopener');
      // نبضة الحضور ما دامت الصفحة مفتوحة
      const timer = setInterval(() => {
        if (!document.body.contains(box)) return clearInterval(timer);
        db.rpc('meeting_ping', { p_id: m.id }).catch(() => {});
      }, 60000);
      await reload();
    } catch (err) { toast(err.message, 'bad'); }
  });

  const cancel = async m => {
    if (!await confirm('إلغاء اللقاء', `يُلغى «${m.title}»، ويُبلَّغ المدعوّون بالإلغاء عند فتحهم المنصة. متابعة؟`,
      'إلغاء اللقاء', 'bad')) return;
    try { await db.rpc('cancel_meeting', { p_id: m.id, p_on: true }); toast('أُلغي اللقاء.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const attendance = async m => {
    const rows = await db.select('meeting_invitees', { select: 'member_id,joined_at,seconds', meeting_id: `eq.${m.id}` })
      .catch(() => []);
    const nameOf = id => data.members.find(x => x.id === id)?.full_name || '—';
    await dialog({
      title: `سجلّ الحضور — ${m.title}`,
      body: h('div.stack',
        h('p.small.muted', `${fmtDateTime(m.starts_at)} · ${m.minutes} دقيقة · ${m.room_name || 'بلا قاعة'}`),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['المدعوّ', 'الدخول', 'المدة'].map(t => h('th', t)))),
          h('tbody', rows.length ? rows.map(r => h('tr',
            h('td', { 'data-label': 'المدعوّ' }, nameOf(r.member_id)),
            h('td', { 'data-label': 'الدخول' }, r.joined_at ? fmtDateTime(r.joined_at)
              : h('span.badge.warn', 'لم يحضر')),
            h('td', { 'data-label': 'المدة' }, r.joined_at ? `${ar(mins(r.seconds))} دقيقة` : '—')))
            : [h('tr', h('td', { colspan: '3' }, h('p.muted', 'لا مدعوّين.')))]))),
        h('p.small.muted', `حضر ${rows.filter(r => r.joined_at).length} من ${rows.length}.`)),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  };

  function card(m) {
    const open = isOpen(m);
    const past = isPast(m);
    const badge = m.status === 'cancelled' ? h('span.badge.bad', 'ملغًى')
      : open ? h('span.badge.ok', 'مفتوح الآن')
        : past ? h('span.badge', 'انتهى') : h('span.badge.gold', 'قادم');
    const joinBtn = h('button.btn.sm.primary', { type: 'button' }, '▶ انضمام');
    joinBtn.onclick = e => join(e.currentTarget, m);
    return h('article.card.stack.meet-card', { class: open ? 'open' : '' },
      h('div.row.between',
        h('div', h('b', `${KIND_ICON[m.kind] || '📌'} ${m.title}`),
          h('div.small.muted', `${m.kind} · ${m.room_name || 'بلا قاعة'}`)),
        badge),
      h('div.row.wrap.small.muted',
        h('span', fmtDateTime(m.starts_at)),
        h('span.sep', '·'), h('span', `${m.minutes} دقيقة`),
        h('span.sep', '·'), h('span', `${ar(m.invited)} مدعوًّا`),
        m.attended ? h('span.sep', '·') : null,
        m.attended ? h('span', `حضر ${ar(m.attended)}`) : null,
        m.organizer ? h('span.sep', '·') : null,
        m.organizer ? h('span', `نظّمه ${m.organizer}`) : null),
      m.description ? h('p.small', m.description) : null,
      h('div.row.wrap',
        m.status === 'scheduled' && open ? joinBtn : null,
        m.status === 'scheduled' && !open && !past
          ? h('span.small.muted', 'يُفتح زرّ الانضمام قبل الموعد بربع ساعة.') : null,
        admin ? h('button.btn.xs', { type: 'button', onclick: () => attendance(m) }, 'سجلّ الحضور') : null,
        admin && m.status === 'scheduled' && !past
          ? h('button.btn.xs', { type: 'button', onclick: () => edit(m) }, 'تعديل') : null,
        admin && m.status === 'scheduled' && !past
          ? h('button.btn.xs.bad', { type: 'button', onclick: () => cancel(m) }, 'إلغاء') : null));
  }

  function draw() {
    const now = Date.now();
    const upcoming = data.meetings.filter(m => new Date(m.ends_at || m.starts_at).getTime() >= now
      && m.status !== 'cancelled');
    const done = data.meetings.filter(m => new Date(m.ends_at || m.starts_at).getTime() < now
      || m.status === 'cancelled');
    box.replaceChildren(
      h('section.stack',
        h('div.row.between', h('h3', 'القادم'), h('span.badge', `${ar(upcoming.length)}`)),
        ...(upcoming.length ? upcoming.slice().reverse().map(card)
          : [h('p.muted', 'لا لقاءات قادمة.')])),
      h('section.stack',
        h('div.row.between', h('h3', 'المنتهي والملغى'), h('span.badge', `${ar(done.length)}`)),
        ...(done.length ? done.slice(0, 20).map(card) : [h('p.muted', 'لا شيء بعد.')])));

    if (!admin) { roomsBox.replaceChildren(); return; }
    roomsBox.replaceChildren(h('section.card.stack',
      h('div.row.between', h('h3', 'القاعات'),
        h('button.btn.xs', { type: 'button', onclick: async () => {
          const p = await roomDialog(null);
          if (!p) return;
          try { await db.rpc('save_room', { p }); toast('أُضيفت القاعة.', 'ok'); await reload(); }
          catch (err) { toast(err.message, 'bad'); }
        } }, '+ قاعة')),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['القاعة', 'السعة', 'الوصف', 'لقاءات قادمة', ''].map(t => h('th', t)))),
        h('tbody', data.rooms.map(r => h('tr',
          h('td', { 'data-label': 'القاعة' }, h('b', r.name),
            r.is_active ? null : h('span.badge.warn', { style: { marginInlineStart: '6px' } }, 'موقوفة')),
          h('td', { 'data-label': 'السعة' }, ar(r.capacity)),
          h('td', { 'data-label': 'الوصف' }, h('span.small.muted', r.description || '—')),
          h('td', { 'data-label': 'لقاءات قادمة' },
            ar(data.meetings.filter(m => m.room_id === r.id && m.status === 'scheduled'
              && new Date(m.ends_at || m.starts_at).getTime() >= Date.now()).length)),
          h('td.row', { 'data-label': '' },
            h('button.btn.xs', { type: 'button', onclick: async () => {
              const p = await roomDialog(r);
              if (!p) return;
              try { await db.rpc('save_room', { p }); toast('حُفظت القاعة.', 'ok'); await reload(); }
              catch (err) { toast(err.message, 'bad'); }
            } }, 'تعديل'),
            isManager() ? h('button.btn.xs.bad', { type: 'button', onclick: async () => {
              if (!await confirm('حذف القاعة', `تُحذف «${r.name}»؟`, 'حذف', 'bad')) return;
              try { await db.rpc('delete_room', { p_id: r.id }); toast('حُذفت القاعة.', 'ok'); await reload(); }
              catch (err) { toast(err.message, 'bad'); }
            } }, 'حذف') : null))))))));
  }

  const addBtn = admin ? h('button.btn.sm.primary', { type: 'button' }, '+ لقاء جديد') : null;
  if (addBtn) addBtn.onclick = () => edit(null);

  draw();
  // الشاشة تحدّث نفسها، فيظهر زرّ الانضمام في وقته بلا إعادة تحميل
  const timer = setInterval(() => { if (!document.body.contains(box)) return clearInterval(timer); draw(); }, 30000);

  return h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, addBtn),
      h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', 'قاعات الاجتماعات والتدريب'),
        h('p.muted', 'دورةٌ أو اجتماع أو ورشة: تُجدوَل في قاعتها، وتصل الدعوة لمن دُعي، '
          + 'ويُفتح زرّ الانضمام في وقته، ويُقيَّد الحضور.'))),
    roomsBox,
    box,
    h('p.small.muted', 'مجرى الصوت والصورة اليوم من رابط الجلسة الذي يلصقه المنظِّم. '
      + 'وحين يُستضاف خادم اللقاءات في الرياض يصير الانضمام داخل المنصة نفسها.'));
}
