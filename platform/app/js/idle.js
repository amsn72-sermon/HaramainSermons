// السكونُ والخروجُ التلقائي (ملاحظة ٢٢٩)
//   إذا سكن المستخدمُ نصفَ ساعةٍ عُرضت عليه شاشةُ المتابعة بعدٍّ تنازليٍّ
//   ظاهر، فإن بلغ السكونُ ساعةً حُفظت المسوّداتُ وخرج حسابُه من نفسه.
//   وأيُّ حركةٍ منه — نقرةٌ أو مفتاحٌ أو تمرير — تُعيد العدَّ من أوله.
import { h } from './ui.js';
import { auth } from './sb.js';

const WARN_MS = 30 * 60 * 1000;   // نصفُ ساعةٍ إلى شاشة المتابعة
const OUT_MS  = 60 * 60 * 1000;   // ساعةٌ إلى الخروج

const savers = new Set();
// تُسجّل الشاشاتُ هنا ما تريد حفظه قبل الخروج (مسوّدةُ نصٍّ أو نموذج)
export function onBeforeSignOut(fn) { savers.add(fn); return () => savers.delete(fn); }

let last = Date.now();
let timer = null, tick = null, veil = null, stopped = true;

const fmt = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function hideVeil() {
  if (veil) {
    try { veil.close(); } catch { /* أُغلقت */ }
    veil.remove(); veil = null;
  }
  if (tick) { clearInterval(tick); tick = null; }
}

async function saveDrafts() {
  for (const fn of savers) {
    try { await fn(); } catch { /* لا يمنع الخروج */ }
  }
}

async function signOutNow() {
  hideVeil();
  stop();
  await saveDrafts();
  try { await auth.signOut(); } catch { /* الجلسة منتهيةٌ أصلًا */ }
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login?idle=1&next=${next}`);
}

function showVeil() {
  if (veil) return;
  const left = h('b.idle-count', { dir: 'ltr' }, fmt(OUT_MS - WARN_MS));
  const stay = h('button.btn.primary', { type: 'button' }, 'أتابع العمل');
  const out = h('button.btn', { type: 'button' }, 'خروجٌ الآن');
  stay.onclick = () => { last = Date.now(); hideVeil(); };
  out.onclick = () => signOutNow();

  veil = h('dialog.idle-dlg', { 'aria-labelledby': 'idle-t' },
    h('div.dlg-body.stack',
      h('h3#idle-t', 'هل تتابع العمل؟'),
      h('p', 'مضى نصفُ ساعةٍ بلا حركة. وإن لم تتابع خرج حسابُك من نفسه بعد:'),
      h('p.idle-timer', left),
      h('p.small.muted', 'وتُحفظ مسوّداتُك قبل الخروج. وهذا صونًا لحسابك إن تركتَ '
        + 'الجهازَ مفتوحًا.'),
      h('div.row', stay, out)));
  document.body.append(veil);
  try { veil.showModal(); } catch { /* متصفحٌ قديم: تبقى ظاهرة */ }
  stay.focus();

  tick = setInterval(() => {
    const idle = Date.now() - last;
    left.textContent = fmt(OUT_MS - idle);
    if (idle >= OUT_MS) signOutNow();
  }, 1000);
}

function check() {
  if (stopped) return;
  const idle = Date.now() - last;
  if (idle >= OUT_MS) { signOutNow(); return; }
  if (idle >= WARN_MS) showVeil();
}

// الحركةُ تُعيد العدَّ — ولا تُعيده النقرةُ على شاشة المتابعة نفسِها
function bump(e) {
  if (veil && veil.contains(e?.target)) return;
  last = Date.now();
  if (veil) hideVeil();
}

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

export function start() {
  if (!stopped) return;
  stopped = false;
  last = Date.now();
  EVENTS.forEach(ev => window.addEventListener(ev, bump, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', onVisible);
  timer = setInterval(check, 15000);
}

function onVisible() { if (document.visibilityState === 'visible') check(); }

export function stop() {
  stopped = true;
  if (timer) { clearInterval(timer); timer = null; }
  EVENTS.forEach(ev => window.removeEventListener(ev, bump, { capture: true }));
  document.removeEventListener('visibilitychange', onVisible);
  hideVeil();
}

export const IDLE = { WARN_MS, OUT_MS };
