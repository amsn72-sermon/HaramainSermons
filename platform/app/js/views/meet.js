// بوّابة اللقاء: تُقيَّد بها حضورُ العضو، ويُحمَل اسمُه من المنصة في رابط
// الجلسة فلا يُسأل عنه ولا يُغيّره، ثم تُفتح الجلسة في نافذتها.
//   وخدمة اللقاء العامة لا تُجيز التضمين في الإنتاج — تقطع المكالمة بعد
//   خمس دقائق — فالجلسة في نافذةٍ مستقلة، والإذن بالدخول من غرفة انتظارها
//   (ملاحظتا ١٧٥ و١٧٩).
import { h, toast, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin } from '../store.js';

// اسم العضو ومسلكُه يُحمَلان في الرابط، فتفتح الجلسة بهما بلا سؤال
export function sessionUrl(url, name) {
  const base = String(url || '').split('#')[0];
  if (!base) return '';
  const hash = [
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(name || 'عضو المنصة'))}`,
    'config.prejoinConfig.enabled=false',
    'config.prejoinPageEnabled=false',
    'config.disableProfile=true',
    'config.readOnlyName=true',
    'config.startWithAudioMuted=true',
    'config.doNotStoreRoom=true',
    'interfaceConfig.MOBILE_APP_PROMO=false'
  ].join('&');
  return `${base}#${hash}`;
}

export function openSession(url, name) {
  const full = sessionUrl(url, name);
  if (!full) return false;
  const w = window.open(full, '_blank', 'noopener');
  if (!w) { toast('اسمح بالنوافذ المنبثقة لهذا الموقع، ثم أعد المحاولة.', 'bad'); return false; }
  return true;
}

export async function render(ctx) {
  const kind = ctx.params.kind === 'r' ? 'r' : 'm';
  const id = ctx.params.id;
  const admin = isAdmin();
  const me = state.profile?.full_name || 'عضو المنصة';

  const fail = (title, text) => h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', title))),
    h('div.card.stack', h('p', text),
      h('div.row', h('a.btn', { href: '/app/rooms' }, '→ رجوع إلى القاعات'))));

  let url = '', title = '', subtitle = '', meeting = null, invitees = [];
  try {
    if (kind === 'm') {
      const rows = await db.select('meeting_rows', { select: '*', id: `eq.${id}` });
      meeting = rows[0];
      if (!meeting) return fail('اللقاء غير موجود', 'قد يكون حُذف، أو لست من مدعوّيه.');
      title = meeting.title;
      subtitle = `${meeting.kind} · ${meeting.room_name || 'بلا قاعة'} · ${fmtDateTime(meeting.starts_at)} · ${meeting.minutes} دقيقة`;
      // الانضمام يفتح الباب في وقته ويقيّد الحضور
      const raw = await db.rpc('join_meeting', { p_id: id });
      url = String(raw || '').replace(/^"|"$/g, '');
      if (admin) {
        const inv = await db.select('meeting_invitees', {
          select: 'member_id,profiles(full_name)', meeting_id: `eq.${id}` }).catch(() => []);
        invitees = inv.map(x => (x.profiles?.full_name || '').trim()).filter(Boolean);
      }
    } else {
      const rows = await db.select('rooms', { select: '*', id: `eq.${id}` });
      const room = rows[0];
      if (!room) return fail('القاعة غير موجودة', 'راجع المنسق.');
      title = room.name;
      subtitle = room.description || 'قاعة دائمة';
      url = room.join_url || '';
    }
  } catch (err) {
    return fail('تعذّر فتح اللقاء', err.message);
  }
  if (!url) return fail('لا رابط لهذه القاعة', 'اضبط رابطها من إعداد القاعة، ثم أعد المحاولة.');

  // ---------------- الدخول ----------------
  const status = h('p.small.muted');
  let pinger = null;
  const enter = h('button.btn.primary.enter-btn', { type: 'button' }, '▶ الدخول إلى الجلسة');
  enter.onclick = () => {
    if (!openSession(url, me)) return;
    status.textContent = 'فُتحت الجلسة في نافذةٍ أخرى. إن لم تظهر فابحث عنها في نوافذ متصفحك.';
    if (kind === 'm' && !pinger) {
      pinger = setInterval(() => db.rpc('meeting_ping', { p_id: id }).catch(() => {}), 60000);
    }
  };

  const page = h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
        h('a.btn.sm', { href: '/app/rooms' }, '→ رجوع إلى القاعات')),
      h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', title), h('p.muted', subtitle))),

    h('section.card.stack.enter-card',
      h('h3', 'تدخل باسمك من المنصة'),
      h('p', 'سيُفتح لك باب الجلسة باسم ', h('b', me),
        ' — لا تُسأل عن اسمٍ ولا تكتب غيره.'),
      h('div.row', enter),
      status,
      h('p.small.muted', 'وإن حُجبت النافذة فاسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد الضغط.')),

    // خدمةُ اللقاء العامة لا تبدأ الجلسةَ حتى يدخلها مضيفٌ مسجَّل، ومن سبقه
    // حُبس على شاشة الانتظار. فالمضيفُ يفتح القاعة قبل الفريق (ملاحظة ١٩٩).
    admin ? h('section.card.stack',
      h('h3', 'المضيف يفتح القاعة قبل الفريق'),
      h('p.small', 'خدمةُ اللقاء لا تبدأ الجلسة حتى يدخلها مضيفٌ مسجَّلُ الدخول عندها. '
        + 'فمن دخل قبلك حُبس على شاشة «يجري طلب إذنٍ للدخول» ولو كان مدعوًّا.'),
      h('ol.small',
        h('li', 'ادخل الجلسة ', h('b', 'أولًا'), ' قبل بقية الفريق بدقائق.'),
        h('li', 'إن ظهر لك «أنا المضيف» فاضغطه وسجّل الدخول ',
          h('b', 'بحساب المشروع المعتمد للقاعات'), ' — لا بحسابك الشخصي.'),
        h('li', 'وإن حُجبت نافذةُ تسجيل الدخول فاسمح بالنوافذ المنبثقة لموقع الجلسة '
          + 'ثم أعد الضغط.'),
        h('li', 'ومن شريط الجلسة: الأمان (Security) ← فعّل ',
          h('b', 'غرفة الانتظار (Lobby)'), ' — فيصلك اسمُ كل طالبِ دخول فتأذن أو تردّ.')),
      meeting && invitees.length ? h('div.stack',
        h('b.small', `المدعوّون (${invitees.length}) — ليكن بين يديك عند الإذن:`),
        h('ul.small.inv-names', invitees.map(n => h('li', n)))) : null)
      : h('p.small.muted', 'وإن ظهرت لك شاشةُ انتظارٍ فالقاعة لم يفتحها المضيف بعد، '
          + 'أو أنك في غرفة الانتظار حتى يأذن لك — فلا تُغلق النافذة ولا تضغط «أنا المضيف».'),

    h('p.small.muted', 'الجلسة على خدمةٍ خارجية، والمنصة تتولّى الجدولة والدعوة والدخول في وقته '
      + 'وسجلّ الحضور. والرابط مفتاح الجلسة فلا يُنشر.'));

  // المؤقّت يتوقف متى غادر العضو الشاشة
  const watch = new MutationObserver(() => {
    if (!document.body.contains(page)) { if (pinger) clearInterval(pinger); watch.disconnect(); }
  });
  watch.observe(document.body, { childList: true, subtree: true });

  return page;
}
