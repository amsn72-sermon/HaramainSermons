// خمول الجلسة: تنبيه قبل الخروج، فلا يبقى الحساب مفتوحًا بلا رقيب (ملاحظة ٩٧)
import { h, toast } from './ui.js';
import { auth } from './sb.js';

export const IDLE = {
  minutes: 20,        // مدة الخمول قبل التنبيه
  graceSeconds: 60    // مهلة الرد قبل الخروج التلقائي
};

let timer = null, dialogEl = null, tick = null;
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'visibilitychange'];

function clearAll() {
  clearTimeout(timer); timer = null;
  clearInterval(tick); tick = null;
  if (dialogEl) { try { dialogEl.close(); } catch { /* أُغلقت */ } dialogEl.remove(); dialogEl = null; }
}

function ask() {
  let left = IDLE.graceSeconds;
  const count = h('b', String(left));
  const stay = h('button.btn.primary', { type: 'button' }, 'متابعة العمل');
  const out = h('button.btn', { type: 'button' }, 'تسجيل الخروج');

  dialogEl = h('dialog.idle-dlg', { 'aria-labelledby': 'idle-t' },
    h('div.dlg-body',
      h('h3#idle-t', 'هل ما زلت هنا؟'),
      h('p', 'لم يُسجَّل أي نشاط منذ مدة. سيُغلق حسابك تلقائيًّا خلال ', count, ' ثانية حفظًا لبياناتك.'),
      h('div.row', stay, out)));
  document.body.append(dialogEl);
  dialogEl.showModal();

  const bye = async () => { clearAll(); await auth.signOut(); };
  stay.onclick = () => { clearAll(); start(); toast('تابع عملك.', 'ok'); };
  out.onclick = bye;

  tick = setInterval(() => {
    left -= 1;
    count.textContent = String(left);
    if (left <= 0) bye();
  }, 1000);
}

function reset() {
  if (dialogEl) return;                 // النافذة مفتوحة: لا يُعاد العدّ إلا بالضغط
  clearTimeout(timer);
  timer = setTimeout(ask, IDLE.minutes * 60 * 1000);
}

export function start() {
  stop();
  for (const ev of ACTIVITY) window.addEventListener(ev, reset, { passive: true });
  reset();
}

export function stop() {
  for (const ev of ACTIVITY) window.removeEventListener(ev, reset);
  clearAll();
}
