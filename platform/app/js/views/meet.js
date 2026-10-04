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

  let url = '', title = '', subtitle = '', meeting = null, invitees = [], gate = null;
  try {
    if (kind === 'm') {
      const rows = await db.select('meeting_rows', { select: '*', id: `eq.${id}` });
      meeting = rows[0];
      if (!meeting) return fail('اللقاء غير موجود', 'قد يكون حُذف، أو لست من مدعوّيه.');
      title = meeting.title;
      subtitle = `${meeting.kind} · ${meeting.room_name || 'بلا قاعة'} · ${fmtDateTime(meeting.starts_at)} · ${meeting.minutes} دقيقة`;
      if (admin) {
        const inv = await db.select('meeting_invitees', {
          select: 'member_id,profiles(full_name)', meeting_id: `eq.${id}` }).catch(() => []);
        invitees = inv.map(x => (x.profiles?.full_name || '').trim()).filter(Boolean);
      }
    } else {
      const rows = await db.select('rooms', { select: 'id,name,description', id: `eq.${id}` });
      const room = rows[0];
      if (!room) return fail('القاعة غير موجودة', 'راجع المنسق.');
      title = room.name;
      subtitle = room.description || 'قاعة دائمة';
    }
    // البوّابة: الإداريُّ يدخل بلا إذن، وغيرُه ينتظر في الردهة (ملاحظة ٢٠٣)
    gate = await db.rpc('meet_gate', { p_kind: kind, p_id: id });
    url = gate?.url || '';
    // الانضمام يفتح الباب في وقته ويقيّد الحضور
    if (kind === 'm' && gate?.state === 'admitted') {
      await db.rpc('join_meeting', { p_id: id });
    }
  } catch (err) {
    return fail('تعذّر فتح اللقاء', err.message);
  }
  if (gate?.state === 'admitted' && !url) {
    return fail('لا رابط لهذه القاعة', 'اضبط رابطها من إعداد القاعة، ثم أعد المحاولة.');
  }

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

  // بطاقةُ الدخول تتبدّل بحال صاحبِها: مأذونٌ، أو في الردهة، أو مردود
  const enterCard = h('section.card.stack.enter-card');
  const drawEnter = () => {
    const st = gate?.state || 'waiting';
    if (st === 'admitted') {
      enterCard.replaceChildren(
        h('h3', 'تدخل باسمك من المنصة'),
        h('p', 'سيُفتح لك باب الجلسة باسم ', h('b', me), ' — لا تُسأل عن اسمٍ ولا تكتب غيره.'),
        h('div.row', enter),
        status,
        h('p.small.muted', 'وإن حُجبت النافذة فاسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد الضغط.'));
    } else if (st === 'nohost') {
      // قُبل طلبُه، ولم يدخل مضيفٌ الغرفةَ بعد. فلا يُفتح له الرابطُ
      // لئلا تستقبله رسالةُ «أنا المضيف» (ملاحظة ٢٣٦ أ)
      enterCard.replaceChildren(
        h('h3', 'أُذن لك — والمضيفُ لم يدخل بعد'),
        h('p', 'طلبُك مقبول، ولا ينقص إلا دخولُ المنسق إلى الغرفة. ',
          'وما إن يدخل حتى يُفتح لك البابُ هنا من نفسه.'),
        h('div.wait-dots', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
        h('p.small.muted', 'ولا نفتح لك الجلسةَ قبله لئلا تستقبلك رسالةُ خدمة اللقاءات '
          + '«في انتظار المضيف».'),
        h('p.small.muted', 'ابقَ على هذه الصفحة.'));
    } else if (st === 'denied') {
      enterCard.replaceChildren(
        h('h3', 'لم يُؤذن لك بالدخول'),
        h('p', 'ردَّ المنسقُ طلبَك. راجعه إن كان في ذلك لبس.'),
        h('div.row', h('a.btn', { href: '/app/rooms' }, '→ رجوع إلى القاعات')));
    } else {
      enterCard.replaceChildren(
        h('h3', 'أنت في ردهة الانتظار'),
        h('p', 'طُلب لك الإذنُ بالدخول باسم ', h('b', me),
          '. وما إن يأذن أحدُ المنسقين حتى يُفتح لك الباب هنا من نفسه.'),
        h('div.wait-dots', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
        h('p.small.muted', Number(gate?.hosts) > 0
          ? 'في القاعة منسقٌ الآن — لن يطول انتظارك بإذن الله.'
          : 'لم يدخل منسقٌ بعدُ. ابقَ على هذه الصفحة، فالإذن يصلك متى دخل.'),
        h('p.small.muted', 'ولا تُغلق الصفحة: إغلاقُها يُسقط طلبَك فتعيده من جديد.'));
    }
  };
  drawEnter();

  // ---------------- الردهة: للإداريّين ----------------
  const lobbyList = h('div.stack');
  const lobbyCard = admin ? h('section.card.stack',
    h('h3', 'من ينتظر الإذن'),
    h('p.small.muted', 'كلُّ من ليس منسقًا ينتظر هنا حتى تأذن له. والقائمةُ تتجدّد من نفسها.'),
    lobbyList) : null;

  const drawLobby = rows => {
    if (!rows.length) {
      lobbyList.replaceChildren(h('p.small.muted', 'لا أحد في الردهة الآن.'));
      return;
    }
    lobbyList.replaceChildren(h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الاسم', 'منذ', ''].map(t => h('th', t)))),
      h('tbody', rows.map(r => {
        const decide = ok => async () => {
          try {
            await db.rpc('meet_decide', { p_row: r.id, p_ok: ok });
            toast(ok ? `أُذن لـ${r.full_name}.` : `رُدّ طلبُ ${r.full_name}.`, ok ? 'ok' : '');
            pollLobby();
          } catch (e) { toast(e.message, 'bad'); }
        };
        return h('tr',
          h('td', { 'data-label': 'الاسم' }, h('b', r.full_name)),
          h('td', { 'data-label': 'منذ' }, `${Math.max(1, Math.round((r.waiting_sec || 0) / 60))} د`),
          h('td', h('div.row',
            h('button.btn.sm.primary', { type: 'button', onclick: decide(true) }, 'أذِن'),
            h('button.btn.sm.ghost', { type: 'button', onclick: decide(false) }, 'ردّ'))));
      })))));
  };

  const rotate = h('button.btn.sm.ghost', { type: 'button' }, 'بدّل اسم الغرفة');
  rotate.onclick = async () => {
    rotate.disabled = true;
    try {
      const u = await db.rpc('meet_rotate', { p_kind: kind, p_id: id });
      url = String(u || '').replace(/^"|"$/g, '');
      toast('بُدّل اسمُ الغرفة. من كان داخلها على الاسم القديم خرج، ومن أُذن له يعيد الطلب.', 'ok');
      pollLobby();
    } catch (e) { toast(e.message, 'bad'); }
    rotate.disabled = false;
  };

  // ---------------- التجديد الدوري ----------------
  let timer = null;
  async function pollLobby() {
    if (!admin) return;
    try { drawLobby(await db.rpc('meet_waiting', { p_kind: kind, p_id: id }) || []); }
    catch { /* يُعاد في الدورة القادمة */ }
  }
  async function pollGate() {
    try {
      const g = await db.rpc('meet_gate', { p_kind: kind, p_id: id });
      const was = gate?.state;
      gate = g;
      if (g?.url) url = g.url;
      if (was !== g?.state) {
        drawEnter();
        if (g?.state === 'nohost') toast('أُذن لك — ننتظر دخول المنسق.', 'ok');
        if (g?.state === 'admitted') {
          toast(was === 'nohost' ? 'دخل المنسقُ — الباب مفتوح.' : 'أُذن لك بالدخول.', 'ok');
          if (kind === 'm') await db.rpc('join_meeting', { p_id: id }).catch(() => {});
        }
      }
    } catch { /* يُعاد في الدورة القادمة */ }
  }
  pollLobby();
  timer = setInterval(() => { pollGate(); pollLobby(); }, 8000);

  const page = h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
        h('a.btn.sm', { href: '/app/rooms' }, '→ رجوع إلى القاعات')),
      h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', title), h('p.muted', subtitle))),

    enterCard,
    lobbyCard,

    // اسمُ الغرفة عندنا لا يُعرف لمن لم يُؤذن له، فلا يسبق المترجمُ المنسقَ
    // إليها فيصير مضيفًا. والمضيفُ مع ذلك يفتحها قبل الفريق (ملاحظتا ١٩٩ و٢٠٣).
    admin ? h('section.card.stack',
      h('h3', 'المضيف يفتح القاعة قبل الفريق'),
      h('p.small', 'اسمُ الغرفة يُتمّه جزءٌ لا يُخمَّن، ولا تُسلّمه المنصةُ إلا لمن أُذن له. '
        + 'فمن لم يأذن له منسقٌ لا يبلغ الغرفةَ أصلًا، ولو كان الرابطُ الأصلُ عنده.'),
      h('ol.small',
        h('li', 'ادخل الجلسة ', h('b', 'أولًا'), ' قبل بقية الفريق بدقائق.'),
        h('li', 'إن ظهر لك «أنا المضيف» فاضغطه وسجّل الدخول ',
          h('b', 'بحساب المشروع المعتمد للقاعات'), ' — لا بحسابك الشخصي.'),
        h('li', 'ومن أراد الدخول ظهر اسمُه في «من ينتظر الإذن» أعلاه، فتأذن أو تردّ.'),
        h('li', 'وإن خشيتَ أن اسمَ الغرفة انكشف فبدّله: تُغلق القديمةُ على من فيها، ',
          'ويعود غيرُ المنسقين إلى الردهة.')),
      h('div.row', rotate),
      meeting && invitees.length ? h('div.stack',
        h('b.small', `المدعوّون (${invitees.length}) — ليكن بين يديك عند الإذن:`),
        h('ul.small.inv-names', invitees.map(n => h('li', n)))) : null) : null,

    h('p.small.muted', 'الجلسة على خدمةٍ خارجية، والمنصة تتولّى الجدولة والدعوة والإذن بالدخول '
      + 'وسجلّ الحضور. والرابط مفتاح الجلسة فلا يُنشر.'));

  // المؤقّتات تتوقف متى غادر العضو الشاشة
  const watch = new MutationObserver(() => {
    if (!document.body.contains(page)) {
      if (pinger) clearInterval(pinger);
      if (timer) clearInterval(timer);
      watch.disconnect();
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });

  return page;
}
