// قاعة اللقاء داخل المنصة: تُفتح الجلسة في الشاشة نفسها، فيدخل العضو
// باسمه من المنصة لا باسمٍ يكتبه، وتُفعَّل غرفة الانتظار متى دخل المنسق،
// فيصله إشعارٌ باسم كل طارق، ويقبله أو يردّه — والقبول والردّ للمنسق
// ومدير المشروع وحدهما (ملاحظة ١٧٥).
import { h, toast, confirm, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin } from '../store.js';

const JITSI_HOST = 'meet.jit.si';

function loadApi(host) {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `https://${host}/external_api.js`;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('تعذّر تحميل خدمة اللقاء — راجع اتصالك.'));
    document.head.append(s);
  });
}

// نغمةٌ قصيرة عند الطرق، فلا يفوت المنسق طارقٌ وهو يتحدّث
function knockTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch { /* الصوت زينة لا شرط */ }
}

export async function render(ctx) {
  const kind = ctx.params.kind === 'r' ? 'r' : 'm';
  const id = ctx.params.id;
  const admin = isAdmin();
  const back = () => ctx.navigate('/app/rooms' + (kind === 'r' ? '' : ''), { replace: true });

  const fail = (title, text) => h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', title))),
    h('div.card.stack', h('p', text),
      h('div.row', h('a.btn', { href: '/app/rooms' }, '→ رجوع إلى القاعات'))));

  // ---------------- بيانات اللقاء أو القاعة ----------------
  let url = '', title = '', subtitle = '', meeting = null, invitees = [];
  try {
    if (kind === 'm') {
      const rows = await db.select('meeting_rows', { select: '*', id: `eq.${id}` });
      meeting = rows[0];
      if (!meeting) return fail('اللقاء غير موجود', 'قد يكون حُذف، أو لست من مدعوّيه.');
      title = meeting.title;
      subtitle = `${meeting.kind} · ${meeting.room_name || 'بلا قاعة'} · ${fmtDateTime(meeting.starts_at)}`;
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

  let host = JITSI_HOST, roomName = '';
  try { const u = new URL(url); host = u.host; roomName = decodeURIComponent(u.pathname.replace(/^\//, '')); }
  catch { return fail('رابط غير صالح', 'راجع إعداد القاعة.'); }

  // خدمةٌ غير المعتمدة لا تُضمَّن في الشاشة، فتُفتح في نافذتها
  if (host !== JITSI_HOST) {
    return h('div',
      h('div.page-head', h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', title), h('p.muted', subtitle))),
      h('div.card.stack',
        h('p', 'هذه الجلسة على خدمةٍ خارج المعتمَد، فتُفتح في نافذة مستقلة ولا تظهر فيها '
          + 'غرفة الانتظار ولا إشعار الطارقين.'),
        h('div.row',
          h('button.btn.primary', { type: 'button',
            onclick: () => window.open(url, '_blank', 'noopener') }, '▶ فتح الجلسة'),
          h('a.btn', { href: '/app/rooms' }, '→ رجوع'))));
  }

  // ---------------- الشاشة ----------------
  const frameBox = h('div.meet-frame');
  const knockBox = h('div.stack.knock-box');
  const status = h('span.badge', 'جارٍ الدخول…');
  const lobbyBadge = h('span.badge.warn', 'غرفة الانتظار: لم تُفعَّل بعد');

  const leaveBtn = h('button.btn.sm.danger', { type: 'button' }, 'مغادرة اللقاء');
  const fullBtn = h('button.btn.sm', { type: 'button' }, '⛶ ملء الشاشة');

  const page = h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, fullBtn, leaveBtn),
      h('div.grow', h('div.eyebrow', 'القاعات'), h('h1', title), h('p.muted', subtitle))),
    h('div.row.wrap', { style: { marginBottom: '10px' } }, status, admin ? lobbyBadge : null),
    admin ? h('section.card.stack.knock-card',
      h('div.row.between', h('h3', 'طلبات الدخول'),
        h('span.small.muted', 'القبول والردّ للمنسق ومدير المشروع')),
      knockBox) : null,
    frameBox,
    h('p.small.muted', 'تدخل باسمك كما هو في المنصة، فلا يُكتب اسمٌ غيره. '
      + (admin
        ? 'وغرفة الانتظار تُفعَّل تلقائيًّا متى دخلتَ، فلا يدخل أحدٌ قبل إذنك.'
        : 'ومن أراد الدخول انتظر إذن المنسق.')));

  const knocks = new Map();
  let api = null;
  const paintKnocks = () => {
    if (!admin) return;
    knockBox.replaceChildren(...(knocks.size
      ? [...knocks.values()].map(k => {
          const known = invitees.some(n => n && k.name && (n === k.name || n.includes(k.name) || k.name.includes(n)));
          const accept = h('button.btn.sm.primary', { type: 'button' }, 'قبول');
          const reject = h('button.btn.sm.danger', { type: 'button' }, 'ردّ');
          const answer = ok => {
            try { api && api.executeCommand('answerKnockingParticipant', k.id, ok); } catch { /* الجلسة أُغلقت */ }
            knocks.delete(k.id); paintKnocks();
            toast(ok ? `أُذن لـ${k.name}.` : `رُدَّ ${k.name}.`, ok ? 'ok' : 'warn');
          };
          accept.onclick = () => answer(true);
          reject.onclick = () => answer(false);
          return h('div.row.between.knock-row',
            h('div', h('b', k.name || 'بلا اسم'),
              h('div.small', known
                ? h('span.badge.ok', 'من المدعوّين')
                : h('span.badge.warn', 'ليس من المدعوّين'))),
            h('div.row', accept, reject));
        })
      : [h('p.muted.small', 'لا أحد ينتظر الآن.')]));
  };
  paintKnocks();

  // ---------------- تشغيل الجلسة ----------------
  let pinger = null;
  const stop = () => {
    if (pinger) clearInterval(pinger);
    try { api && api.dispose(); } catch { /* أُغلقت */ }
    api = null;
  };
  // تُغلق الجلسة متى غادر العضو الشاشة
  const watch = new MutationObserver(() => {
    if (!document.body.contains(page)) { stop(); watch.disconnect(); }
  });
  watch.observe(document.body, { childList: true, subtree: true });

  leaveBtn.onclick = async () => {
    if (!await confirm('مغادرة اللقاء', 'تخرج من الجلسة وتعود إلى القاعات. متابعة؟', 'مغادرة')) return;
    stop(); back();
  };
  fullBtn.onclick = () => {
    const el = frameBox;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => toast('المتصفح لم يسمح بملء الشاشة.', 'bad'));
  };

  (async () => {
    try {
      await loadApi(host);
      api = new window.JitsiMeetExternalAPI(host, {
        roomName,
        parentNode: frameBox,
        userInfo: {
          displayName: state.profile?.full_name || 'عضو المنصة',
          email: state.profile?.email || ''
        },
        configOverwrite: {
          // لا صفحة تمهيد تسأل عن الاسم، فالاسم من المنصة
          prejoinPageEnabled: false,
          prejoinConfig: { enabled: false },
          disableProfile: true,              // فلا يُغيّر اسمه داخل الجلسة
          readOnlyName: true,
          startWithAudioMuted: true,
          disableInviteFunctions: true,
          doNotStoreRoom: true,
          enableWelcomePage: false
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          MOBILE_APP_PROMO: false,
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: false
        }
      });

      api.addEventListener('videoConferenceJoined', () => {
        status.textContent = 'أنت في الجلسة';
        status.className = 'badge ok';
        // غرفة الانتظار تُفتح بيد المنسق، فلا يدخل أحدٌ بلا إذن
        if (admin) {
          setTimeout(() => {
            try {
              api.executeCommand('toggleLobby', true);
              lobbyBadge.textContent = 'غرفة الانتظار: مفعّلة';
              lobbyBadge.className = 'badge ok';
            } catch {
              lobbyBadge.textContent = 'غرفة الانتظار: فعّلها من «الأمان» داخل الجلسة';
            }
          }, 1500);
        }
        if (kind === 'm') {
          pinger = setInterval(() => db.rpc('meeting_ping', { p_id: id }).catch(() => {}), 60000);
        }
      });

      api.addEventListener('knockingParticipant', e => {
        const p = e?.participant || {};
        if (!p.id) return;
        knocks.set(p.id, { id: p.id, name: (p.name || '').trim() });
        paintKnocks();
        if (admin) { knockTone(); toast(`${p.name || 'أحدهم'} يطلب الدخول.`, 'warn'); }
      });

      api.addEventListener('participantJoined', e => {
        knocks.delete(e?.id); paintKnocks();
      });

      api.addEventListener('videoConferenceLeft', () => { stop(); back(); });
      api.addEventListener('readyToClose', () => { stop(); back(); });
    } catch (err) {
      frameBox.replaceChildren(h('div.card.stack',
        h('p.bad', err.message),
        h('div.row',
          h('button.btn', { type: 'button', onclick: () => window.open(url, '_blank', 'noopener') },
            'فتح الجلسة في نافذة'),
          h('a.btn', { href: '/app/rooms' }, '→ رجوع'))));
    }
  })();

  return page;
}
