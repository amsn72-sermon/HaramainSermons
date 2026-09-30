// قاعات الاجتماعات والتدريب: تُدخَل ببطاقتين كبيرتين، ثم قاعاتُ النوع
// ولقاءاتُه — القادم بطاقات، والمنتهي سطرًا سطرًا بأيقوناته (ملاحظتا ١٦٣ و١٦٧).
//   ولكل قاعة رابطها الدائم، يُقترح تلقائيًّا ويُعدَّل عند الحاجة (ملاحظة ١٦٦).
import { h, dialog, toast, busy, confirm, fmtDateTime, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin, isManager, ROLE_LABEL } from '../store.js';

export const KINDS = ['دورة تدريبية', 'اجتماع', 'ورشة عمل', 'أخرى'];
const KIND_ICON = { 'دورة تدريبية': '🎓', 'اجتماع': '🗂', 'ورشة عمل': '🛠', 'أخرى': '📌' };

// النوعان اللذان تُدخل بهما الشاشة
export const ROOM_KINDS = {
  meeting: { title: 'قاعة الاجتماعات', lead: 'اجتماعات الإدارة والمنسقين ولقاءات العمل', defaultKind: 'اجتماع' },
  training: { title: 'قاعة التدريب', lead: 'الدورات التدريبية وورش العمل لفريق الترجمة', defaultKind: 'دورة تدريبية' }
};

// رسمٌ خطّي لكل بطاقة — من صنعنا، بهوية الهيئة
const ART = {
  meeting: '<path d="M4 6.5h16v11H4z"/><path d="M8 21h8M12 17.5V21"/>'
    + '<circle cx="8.5" cy="11" r="1.6"/><circle cx="15.5" cy="11" r="1.6"/>'
    + '<path d="M5.8 14.6a3.2 3.2 0 0 1 5.4 0M12.8 14.6a3.2 3.2 0 0 1 5.4 0"/>',
  training: '<path d="M2.5 8.5 12 4l9.5 4.5L12 13z"/><path d="M6.5 10.6V16c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-5.4"/>'
    + '<path d="M21.5 8.5v5"/>'
};

const ICONS = {
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
  cancel: '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.7 2.7 0 1 1 3.4 2.6c-.5.2-.7.6-.7 1.1v.6"/>'
    + '<path d="M12 16.6h.01"/>'
};
function icon(name, size = 18) {
  const s = h('span.ico', { 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
const iconBtn = (name, title, onclick, cls = '') =>
  h('button.icon-btn', { class: cls, type: 'button', title, 'aria-label': title, onclick }, icon(name));

const ar = n => Number(n || 0).toLocaleString('en-US');
const mins = s => Math.round((s || 0) / 60);
const toLocal = iso => {
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const isOpen = m => {
  const s = new Date(m.starts_at), e = new Date(m.ends_at || s);
  const now = Date.now();
  return m.status === 'scheduled' && now >= s.getTime() - 15 * 60000 && now <= e.getTime() + 30 * 60000;
};
export const isPast = m => new Date(m.ends_at || m.starts_at).getTime() < Date.now();

// الاسم العربي يُكتب بحروف لاتينية، فيبقى الرابط مقروءًا لا مُرمَّزًا
const TRANSLIT = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h',
  'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd',
  'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm',
  'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h', 'ئ': 'y', 'ؤ': 'w', 'ء': ''
};
export const slugOf = name => String(name || '')
  .replace(/[ً-ْـ]/g, '')
  .split('').map(c => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join('')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);

// اسمٌ مميّز للرابط، فلا يدخل غريبٌ على اسمٍ شائع
export function suggestUrl(name) {
  const rnd = Math.random().toString(36).slice(2, 7);
  return `https://meet.jit.si/haramain-${slugOf(name) || 'room'}-${rnd}`;
}

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
// نافذة اللقاء
// ---------------------------------------------------------------------
function meetingDialog(data, kind, row = null) {
  const rooms = data.rooms.filter(r => r.kind === kind && (r.is_active || r.id === row?.room_id));
  const f = {
    title: h('input', { value: row?.title || '', 'aria-label': 'عنوان اللقاء' }),
    kind: h('select', { 'aria-label': 'نوع اللقاء' },
      KINDS.map(k => h('option', { value: k, selected: (row?.kind || ROOM_KINDS[kind].defaultKind) === k }, k))),
    room: h('select', { 'aria-label': 'القاعة' },
      rooms.length ? null : h('option', { value: '' }, '— لا قاعات بعد —'),
      rooms.map(r => h('option', { value: r.id, selected: row?.room_id === r.id }, `${r.name} (${r.capacity})`))),
    at: h('input', { type: 'datetime-local', 'aria-label': 'موعد اللقاء', value: row ? toLocal(row.starts_at) : '' }),
    minutes: h('input', { type: 'number', min: 5, max: 720, step: 5, value: row?.minutes ?? 60,
      'aria-label': 'المدة بالدقائق' }),
    url: h('input', { value: row?.join_url || '', dir: 'ltr', placeholder: 'https://meet.jit.si/…',
      'aria-label': 'رابط الانضمام' }),
    desc: h('textarea', { rows: 2, 'aria-label': 'وصف اللقاء' }, row?.description || '')
  };

  // الرابط: من القاعة إن كان لها رابط دائم، وإلا اقتُرح واحدٌ يُقبل أو يُغيَّر (ملاحظة ١٦٦)
  const urlHint = h('small');
  const fresh = h('button.btn.xs', { type: 'button' }, 'اقترح رابطًا آخر');
  fresh.onclick = () => { f.url.value = suggestUrl(f.title.value || ROOM_KINDS[kind].title); delete f.url.dataset.auto; };
  const syncUrl = () => {
    const room = rooms.find(r => r.id === f.room.value);
    if (row) { urlHint.textContent = 'رابط الجلسة — دائمٌ ما دام الاسم كما هو'; return; }
    if (room?.join_url) {
      urlHint.textContent = `الرابط الدائم لـ«${room.name}» — اقبله أو غيّره`;
      if (!f.url.value.trim() || f.url.dataset.auto === 'yes') { f.url.value = room.join_url; f.url.dataset.auto = 'yes'; }
    } else if (!f.url.value.trim() || f.url.dataset.auto === 'yes') {
      f.url.value = suggestUrl(f.title.value || ROOM_KINDS[kind].title);
      f.url.dataset.auto = 'yes';
      urlHint.textContent = 'رابطٌ مقترح لهذا اللقاء — اقبله أو غيّره';
    }
  };
  f.room.addEventListener('change', syncUrl);
  f.url.addEventListener('input', () => { delete f.url.dataset.auto; });
  syncUrl();

  // المدعوّون بمجموعاتهم — ومدير المشروع من الهيئة منهم
  const picked = new Set(row?.invitees || []);
  const boxes = new Map();
  const groupOf = m => (m.role === 'supervisor' ? 'مديرو المشروع من الهيئة'
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
    return h('div.card.stack', h('div.row.between', h('b', g), h('div.row', all, none)), h('div.inv-grid', rows));
  }));
  paint();

  const bad = [];
  const body = h('div.stack',
    h('div.grid-2',
      h('label.field', req('عنوان اللقاء'), f.title),
      h('label.field', 'النوع', f.kind),
      h('label.field', 'القاعة', f.room),
      h('label.field', req('الموعد'), f.at),
      h('label.field', req('المدة بالدقائق'), f.minutes)),
    h('label.field', req('رابط الانضمام'), urlHint, h('div.row', f.url, fresh)),
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
      need(f.url, !f.url.value.trim(), 'ألصق رابط الانضمام أو اقبل المقترح'),
      need(f.url, f.url.value.trim() && !/^https:\/\//i.test(f.url.value.trim()), 'الرابط يبدأ بـ https://')
    ].filter(Boolean);
    if (!errs.length && !picked.size) return 'اختر مدعوًّا واحدًا على الأقل';
    const room = rooms.find(r => r.id === f.room.value);
    if (!errs.length && room && picked.size > room.capacity) {
      toast(`المدعوّون ${picked.size} وسعة «${room.name}» ${room.capacity}.`, 'warn');
    }
    return errs.length ? errs[0] : true;
  };

  return dialog({
    title: row ? 'تعديل اللقاء' : `لقاء جديد في ${ROOM_KINDS[kind].title}`,
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
function roomDialog(kind, row = null) {
  const f = {
    name: h('input', { value: row?.name || '', 'aria-label': 'اسم القاعة' }),
    cap: h('input', { type: 'number', min: 2, max: 1000, value: row?.capacity ?? 25, 'aria-label': 'السعة' }),
    desc: h('input', { value: row?.description || '', 'aria-label': 'وصف القاعة' }),
    url: h('input', { value: row?.join_url || '', dir: 'ltr', placeholder: 'https://meet.jit.si/…',
      'aria-label': 'رابط القاعة الدائم' })
  };
  const suggest = h('button.btn.xs', { type: 'button' }, 'اقترح رابطًا');
  suggest.onclick = () => { f.url.value = suggestUrl(f.name.value || ROOM_KINDS[kind].title); };
  // القاعة الجديدة تُولَّد بلا طلب، ويبقى التغيير بيدك
  if (!row) f.name.addEventListener('blur', () => { if (!f.url.value.trim() && f.name.value.trim()) suggest.click(); });

  return dialog({
    title: row ? 'تعديل القاعة' : `قاعة جديدة في ${ROOM_KINDS[kind].title}`,
    body: h('div.stack',
      h('div.grid-2',
        h('label.field', req('اسم القاعة'), f.name),
        h('label.field', 'السعة', f.cap)),
      h('label.field', 'الوصف', f.desc),
      h('label.field', 'الرابط الدائم — يُضبط من هنا وحده',
        h('small', 'يرثه كل لقاء يُجدوَل في هذه القاعة، ويمكن تغييره في لقاءٍ بعينه'),
        h('div.row', f.url, suggest)),
      h('p.small.muted', 'الرابط لا يظهر في الشاشة ولا يُتداول: الدخول بزرّ «الدخول للقاعة». '
        + 'واجعله مميّزًا لا كلمةً شائعة، وفعّل «غرفة الانتظار» داخل الجلسة '
        + 'فلا يدخل أحد إلا بإذن المضيف.')),
    buttons: [
      { label: 'إلغاء', value: null },
      { label: 'حفظ', kind: 'primary',
        validate: () => {
          if (!f.name.value.trim()) return 'اكتب اسم القاعة';
          const u = f.url.value.trim();
          if (u && !/^https:\/\//i.test(u)) return 'رابط القاعة يبدأ بـ https://';
          return true;
        },
        value: () => ({ id: row?.id || null, kind, name: f.name.value.trim(),
          capacity: Number(f.cap.value) || 25, description: f.desc.value.trim(),
          join_url: f.url.value.trim() }) }
    ]
  });
}

// ---------------------------------------------------------------------
// إرشادات المستخدمين (ملاحظة ١٦٨)
// ---------------------------------------------------------------------
const GUIDE = {
  meeting: [
    ['قبل الاجتماع',
      ['تصلك الدعوة في بريد المنصة (الأجراس أعلى الشاشة) بموعدها ومدتها وعنوانها.',
        'زرّ «الدخول للاجتماع» يظهر في بطاقته قبل الموعد بربع ساعة، ويبقى حتى نصف ساعة بعد انتهائه.',
        'جرّب الميكروفون والكاميرا قبل الموعد بدقائق، وادخل من حاسب أو جوّال متصل باتصال ثابت.',
        'لا رابط يُنشر ولا يُتداول: الدخول من المنصة وحدها، فلا يدخل الجلسة إلا أهلها.']],
    ['أثناء الاجتماع',
      ['ادخل والميكروفون مكتوم، وافتحه عند الكلام فقط — فهذا أنقى للصوت.',
        'اكتب اسمك الكامل كما هو في المنصة، فيُقيَّد حضورك على اسمه.',
        'اطلب الكلمة بزرّ «رفع اليد» داخل الجلسة، ولا تقطع المتحدث.',
        'مشاركة الشاشة من زرّ المشاركة في شريط الجلسة، وأغلقها بعد انتهاء عرضك.']],
    ['بعد الاجتماع',
      ['يُقيَّد حضورك ومدة بقائك تلقائيًّا، ويظهر الاجتماع في «المنتهي والملغى» بسطرٍ واحد.',
        'يفتح المنسق سجلّ الحضور بأيقونة السجلّ أمام سطر الاجتماع.']]
  ],
  training: [
    ['قبل الدورة',
      ['لكل قاعة تدريب بابها الثابت: تدخلها من المنصة بزرّ «الدخول للقاعة» طول الدورة.',
        'تصلك دعوة كل لقاء في بريد المنصة، وزرّ «الدخول للاجتماع» يظهر قبل الموعد بربع ساعة.',
        'احضر من حاسب إن قدرت — فالعرض والشرح أوضح على شاشةٍ واسعة.']],
    ['أثناء الدورة',
      ['ادخل والميكروفون مكتوم، والكاميرا مفتوحة إن تيسّر، فحضورك أدعى للتفاعل.',
        'الأسئلة في المحادثة المكتوبة داخل الجلسة، ويجيب المدرّب في وقت الأسئلة.',
        'من احتاج الخروج فليخرج بهدوء ويرجع، ولا حاجة لاعتذار في المحادثة.']],
    ['بعد الدورة',
      ['مدة بقائك تُقيَّد تلقائيًّا، وعليها تُبنى شهادة الحضور.',
        'من فاتته الجلسة يراجع منسق التدريب في تسجيلها إن كان قد سُجِّل.']]
  ]
};

const TROUBLE = [
  ['«حجب المتصفح النافذة»', 'اسمح بالنوافذ المنبثقة لهذا الموقع، ثم اضغط «الدخول للاجتماع» مرةً أخرى.'],
  ['«الجلسة تنتظر المضيف»', 'المضيف يدخل أولًا ويسجّل دخوله مرة واحدة، ثم يدخل البقية بلا حساب.'],
  ['لا صوت ولا صورة', 'اسمح للمتصفح باستخدام الميكروفون والكاميرا من قفل العنوان، ثم أعد تحميل الصفحة.'],
  ['صوتٌ متقطّع', 'أوقف الكاميرا، وأغلق ما لا تحتاجه من تطبيقات، وقرّب جهازك من موجّه الشبكة.'],
  ['لا أرى زرّ الدخول', 'إن لم تكن مدعوًّا فلن يظهر لك اللقاء أصلًا — راجع المنسق ليضيفك.']
];

function guideDialog(kind) {
  const secs = GUIDE[kind] || GUIDE.meeting;
  return dialog({
    title: `إرشادات ${ROOM_KINDS[kind]?.title || 'القاعات'}`,
    body: h('div.stack.guide',
      h('p.small.muted', 'صفحةٌ واحدة تكفي: كيف تنضمّ، وكيف تتأدّب في الجلسة، وما تفعله إن تعثّرت.'),
      ...secs.map(([t, items]) => h('section.card.stack',
        h('b', t), h('ul.small', items.map(x => h('li', x))))),
      h('section.card.stack',
        h('b', 'إن تعثّرت'),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', h('th', 'ما يظهر لك'), h('th', 'ما تفعله'))),
          h('tbody', TROUBLE.map(([q, a]) => h('tr',
            h('td', { 'data-label': 'ما يظهر لك' }, q),
            h('td', { 'data-label': 'ما تفعله' }, a))))))),
      h('p.small.muted', 'ومجرى الصوت والصورة اليوم من رابط الجلسة الخارجي. '
        + 'وحين يُستضاف خادم اللقاءات في الرياض يصير الانضمام داخل المنصة نفسها.')),
    buttons: [{ label: 'فهمت', value: null }]
  });
}

// ---------------------------------------------------------------------
export async function render(ctx) {
  const data = await load();
  const admin = isAdmin();
  let level = ctx.query.get('kind') || '';
  if (!ROOM_KINDS[level]) level = '';

  const box = h('div.stack');
  const head = h('div.page-head');

  const go = k => {
    level = k;
    const url = k ? `/app/rooms?kind=${k}` : '/app/rooms';
    history.replaceState(null, '', url);
    draw();
  };

  const reload = async () => {
    const fresh = await load();
    Object.assign(data, fresh);
    draw();
  };

  const ofKind = k => data.meetings.filter(m => (m.room_kind || 'meeting') === k);
  const roomsOf = k => data.rooms.filter(r => r.kind === k);

  // ---------------- الإجراءات ----------------
  const edit = async row => {
    let full = row;
    if (row) {
      const inv = await db.select('meeting_invitees', { select: 'member_id', meeting_id: `eq.${row.id}` }).catch(() => []);
      full = { ...row, invitees: inv.map(x => x.member_id) };
    }
    const p = await meetingDialog(data, level || 'meeting', full);
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
      const timer = setInterval(() => {
        if (!document.body.contains(box)) return clearInterval(timer);
        db.rpc('meeting_ping', { p_id: m.id }).catch(() => {});
      }, 60000);
      await reload();
    } catch (err) { toast(err.message, 'bad'); }
  });

  const cancel = async m => {
    if (!await confirm('إلغاء اللقاء', `يُلغى «${m.title}»، ويبقى في السجل. متابعة؟`, 'إلغاء اللقاء', 'bad')) return;
    try { await db.rpc('cancel_meeting', { p_id: m.id, p_on: true }); toast('أُلغي اللقاء.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const removeMeeting = async m => {
    if (!await confirm('حذف اللقاء', `يُحذف «${m.title}» وسجلّ حضوره حذفًا لا رجعة فيه. متابعة؟`, 'حذف', 'bad')) return;
    try { await db.rpc('delete_meeting', { p_id: m.id }); toast('حُذف اللقاء.', 'ok'); await reload(); }
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
            h('td', { 'data-label': 'الدخول' }, r.joined_at ? fmtDateTime(r.joined_at) : h('span.badge.warn', 'لم يحضر')),
            h('td', { 'data-label': 'المدة' }, r.joined_at ? `${ar(mins(r.seconds))} دقيقة` : '—')))
            : [h('tr', h('td', { colspan: '3' }, h('p.muted', 'لا مدعوّين.')))]))),
        h('p.small.muted', `حضر ${rows.filter(r => r.joined_at).length} من ${rows.length}.`)),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  };

  const roomCard = async r => {
    const { qrImg } = await import('../qr.js');
    const dl = h('button.btn.sm', { type: 'button' }, '⤓ تنزيل البطاقة');
    dl.onclick = () => busy(dl, async () => {
      try {
        const { downloadCard } = await import('../servicecards.js');
        await downloadCard({ title: r.name, note: r.description || 'قاعة اجتماعات وتدريب',
          url: r.join_url, key: 'platform' });
      } catch (err) { toast(err.message, 'bad'); }
    });
    const copy = h('button.btn.sm', { type: 'button' }, '⧉ نسخ الرابط');
    copy.onclick = () => navigator.clipboard.writeText(r.join_url)
      .then(() => toast('نُسخ رابط القاعة.', 'ok'))
      .catch(() => toast('تعذّر النسخ — انسخه من إعداد القاعة.', 'bad'));
    await dialog({
      title: `رمز «${r.name}»`,
      body: h('div.stack', { style: { textAlign: 'center' } },
        qrImg(r.join_url, { size: 220, alt: `رمز ${r.name}` }),
        h('p.small.muted', 'يُمسح بكاميرا الجوال فيدخل القاعة مباشرة، بلا حساب ولا تثبيت. '
          + 'والرابط نفسه لا يُعرض، وضبطه من إعداد القاعة.'),
        h('div.row', { style: { justifyContent: 'center' } }, dl,
          admin ? copy : null)),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  };

  const saveRoom = async (kind, row) => {
    const p = await roomDialog(kind, row);
    if (!p) return;
    try { await db.rpc('save_room', { p }); toast(row ? 'حُفظت القاعة.' : 'أُضيفت القاعة.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const removeRoom = async r => {
    if (!await confirm('حذف القاعة', `تُحذف «${r.name}»؟`, 'حذف', 'bad')) return;
    try { await db.rpc('delete_room', { p_id: r.id }); toast('حُذفت القاعة.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  // ---------------- بطاقة لقاءٍ قادم ----------------
  function meetCard(m) {
    const open = isOpen(m);
    const joinBtn = h('button.btn.sm.primary', { type: 'button' }, '▶ الدخول للاجتماع');
    joinBtn.onclick = e => join(e.currentTarget, m);
    return h('article.card.stack.meet-card', { class: open ? 'open' : '' },
      h('div.row.between',
        h('div', h('b', `${KIND_ICON[m.kind] || '📌'} ${m.title}`),
          h('div.small.muted', `${m.kind} · ${m.room_name || 'بلا قاعة'}`)),
        open ? h('span.badge.ok', 'مفتوح الآن') : h('span.badge.gold', 'قادم')),
      h('div.row.wrap.small.muted',
        h('span', fmtDateTime(m.starts_at)),
        h('span.sep', '·'), h('span', `${m.minutes} دقيقة`),
        h('span.sep', '·'), h('span', `${ar(m.invited)} مدعوًّا`),
        m.organizer ? h('span.sep', '·') : null,
        m.organizer ? h('span', `نظّمه ${m.organizer}`) : null),
      m.description ? h('p.small', m.description) : null,
      h('div.row.wrap',
        open ? joinBtn : h('span.small.muted', 'يُفتح زرّ الدخول قبل الموعد بربع ساعة.'),
        admin ? iconBtn('log', 'سجلّ الحضور', () => attendance(m)) : null,
        admin ? iconBtn('edit', 'تعديل البيانات والموعد والرابط والمدعوّين', () => edit(m)) : null,
        admin ? iconBtn('cancel', 'إلغاء اللقاء', () => cancel(m), 'danger') : null,
        isManager() ? iconBtn('trash', 'حذف الاجتماع', () => removeMeeting(m), 'danger') : null));
  }

  // ---------------- سطر لقاءٍ منتهٍ (ملاحظة ١٦٧) ----------------
  function meetRow(m) {
    return h('li.meet-row', { class: m.status === 'cancelled' ? 'off' : '' },
      h('span.mr-title', h('b', m.title),
        m.status === 'cancelled' ? h('span.badge.bad', 'ملغًى') : null),
      h('span.small.muted.mr-meta',
        `${fmtDateTime(m.starts_at)} · ${m.room_name || '—'} · حضر ${ar(m.attended)} من ${ar(m.invited)}`),
      h('span.row.mr-acts',
        admin ? iconBtn('log', 'سجلّ الحضور', () => attendance(m)) : null,
        admin ? iconBtn('edit', 'تعديل البيانات والموعد والرابط والمدعوّين', () => edit(m)) : null,
        isManager() ? iconBtn('trash', 'حذف الاجتماع', () => removeMeeting(m), 'danger') : null));
  }

  // ---------------- الرسم ----------------
  function drawTiles() {
    const guide = h('button.btn.sm', { type: 'button', onclick: () => guideDialog('meeting'),
      title: 'إرشادات المستخدمين', 'aria-label': 'إرشادات المستخدمين' },
      icon('help', 16), h('span', 'إرشادات'));
    head.replaceChildren(
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, guide),
      h('div.grow',
        h('div.eyebrow', 'القاعات'), h('h1', 'قاعات الاجتماعات والتدريب'),
        h('p.muted', 'ادخل القاعة التي تريد: تُجدوَل فيها اللقاءات، وتصل الدعوات، '
          + 'ويُفتح زرّ الانضمام في وقته، ويُقيَّد الحضور.')));

    const tile = k => {
      const rooms = roomsOf(k);
      const list = ofKind(k);
      const soon = list.filter(m => !isPast(m) && m.status === 'scheduled');
      const b = h('button.btn.room-tile', { type: 'button', onclick: () => go(k) });
      b.innerHTML = `<span class="rt-art"><svg viewBox="0 0 24 24" width="64" height="64" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ART[k]}</svg></span>`;
      b.append(
        h('span.rt-title', ROOM_KINDS[k].title),
        h('span.rt-lead', ROOM_KINDS[k].lead),
        h('span.rt-meta',
          h('b', ar(rooms.length)), h('span', rooms.length === 1 ? 'قاعة' : 'قاعات'),
          h('span.sep', '·'),
          h('b', ar(soon.length)), h('span', 'لقاء قادم')));
      return b;
    };
    box.replaceChildren(h('div.room-tiles', tile('meeting'), tile('training')));
  }

  function drawKind(k) {
    const cfg = ROOM_KINDS[k];
    const back = h('button.btn.sm', { type: 'button', onclick: () => go('') }, '→ رجوع إلى القاعات');
    const addMeet = admin ? h('button.btn.sm.primary', { type: 'button', onclick: () => edit(null) }, '+ لقاء جديد') : null;
    const guide = h('button.btn.sm', { type: 'button', onclick: () => guideDialog(k),
      title: 'إرشادات المستخدمين', 'aria-label': 'إرشادات المستخدمين' },
      icon('help', 16), h('span', 'إرشادات'));
    head.replaceChildren(
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, addMeet, guide, back),
      h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', cfg.title), h('p.muted', cfg.lead)));

    const rooms = roomsOf(k);
    const list = ofKind(k);
    const upcoming = list.filter(m => !isPast(m) && m.status === 'scheduled');
    const done = list.filter(m => isPast(m) || m.status === 'cancelled');

    const roomsCard = h('section.card.stack',
      h('div.row.between', h('h3', 'القاعات'),
        admin ? h('button.btn.xs', { type: 'button', onclick: () => saveRoom(k, null) }, '+ قاعة') : null),
      rooms.length ? h('div.room-grid', rooms.map(r => h('div.card.stack.room-item',
        h('div.row.between', h('b', r.name),
          h('span.badge', `${ar(r.capacity)} مقعدًا`)),
        r.description ? h('p.small.muted', r.description) : null,
        h('div.row.wrap',
          r.join_url
            ? h('button.btn.sm.primary', { type: 'button',
                onclick: () => window.open(r.join_url, '_blank', 'noopener') }, '▶ الدخول للقاعة')
            : h('span.small.muted', 'لا باب لها بعد — اضبط رابطها من إعداد القاعة.'),
          r.join_url ? iconBtn('qr', 'رمز القاعة', () => roomCard(r)) : null,
          admin ? iconBtn('edit', 'إعداد القاعة: الاسم والسعة والرابط', () => saveRoom(k, r)) : null,
          isManager() ? iconBtn('trash', 'حذف القاعة', () => removeRoom(r), 'danger') : null))))
        : h('p.muted', 'لا قاعات بعد — أضف أولاها.'));

    box.replaceChildren(
      roomsCard,
      h('section.stack',
        h('div.row.between', h('h3', 'اللقاءات القادمة'), h('span.badge', ar(upcoming.length))),
        ...(upcoming.length ? upcoming.slice().reverse().map(meetCard) : [h('p.muted', 'لا لقاءات قادمة.')])),
      h('section.stack',
        h('div.row.between', h('h3', 'المنتهي والملغى'), h('span.badge', ar(done.length))),
        done.length ? h('ul.meet-list', done.slice(0, 50).map(meetRow)) : h('p.muted', 'لا شيء بعد.')));
  }

  function draw() { level ? drawKind(level) : drawTiles(); }

  draw();
  const timer = setInterval(() => { if (!document.body.contains(box)) return clearInterval(timer); draw(); }, 30000);

  return h('div', head, box,
    h('p.small.muted', 'الروابط لا تُعرض ولا تُتداول: الدخول من المنصة، وضبط الرابط من إعداد القاعة '
      + 'أو الاجتماع. ومجرى الصوت والصورة اليوم من جلسة خارجية، وحين يُستضاف خادم اللقاءات '
      + 'في الرياض يصير الدخول داخل المنصة نفسها.'));
}
