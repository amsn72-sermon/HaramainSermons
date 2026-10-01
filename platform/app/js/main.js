import { auth, configured, db } from './sb.js';
import { h, toast } from './ui.js';
import { state, loadProfile, loadReference, loadPolicyState, loadCircularState, loadMfaState, isAdmin, isManager, isActive, isSupervisor, can } from './store.js';
import { staffShell } from './views/shell.js';
import { start as idleStart, stop as idleStop } from './idle.js';

const DEFAULT_TITLE = document.title;

const routes = [
  // [النمط، الاستيراد، يتطلب دخولًا، للإدارة فقط]
  ['/', () => import('./views/public.js'), false],
  ['/arafah', () => import('./views/public.js').then(m => ({ render: m.arafah })), false],
  ['/about', () => import('./views/about.js'), false],
  ['/verify', () => import('./views/verify.js'), false],
  ['/initiative', () => import('./views/about.js').then(m => ({ render: m.initiative })), false],
  ['/policy', () => import('./views/policy.js'), true],
  ['/mfa', () => import('./views/mfa.js'), true],
  ['/login', () => import('./views/auth.js').then(m => ({ render: m.login })), false],
  ['/register', () => import('./views/auth.js').then(m => ({ render: m.register })), false],
  ['/reset', () => import('./views/auth.js').then(m => ({ render: m.reset })), false],
  ['/app', () => import('./views/home.js'), true],
  ['/app/tasks', () => import('./views/tasks.js').then(m => ({ render: m.list })), true],
  ['/app/tasks/:id', () => import('./views/tasks.js').then(m => ({ render: m.workspace })), true],
  ['/app/new', () => import('./views/new-material.js'), true, true],
  ['/app/staff', () => import('./views/staff.js'), true, true],
  ['/app/staff/admins', () => import('./views/staff.js').then(m => ({ render: m.admins })), true, true],
  ['/app/team', () => import('./views/staff.js'), true, true],
  ['/app/field', () => import('./views/staff.js').then(m => ({ render: m.field })), true, true],
  ['/app/languages', () => import('./views/languages.js'), true, true],
  ['/app/khateebs', () => import('./views/khateebs.js'), true, true],
  ['/app/workflow', () => import('./views/workflow.js'), true, true],
  ['/app/archive', () => import('./views/archive.js'), true, 'reports'],
  ['/app/circulars', () => import('./views/circulars.js'), true],
  ['/app/me', () => import('./views/me.js'), true],
  ['/app/audio-guide', () => import('./views/audioguide.js'), true],
  ['/app/bank-accounts', () => import('./views/staff.js'), true, true],
  ['/app/cards', () => import('./views/cards.js'), true, true],
  ['/app/charter', () => import('./views/charter.js'), true, true],
  ['/app/payroll', () => import('./views/payroll.js'), true, true],
  ['/app/shifts', () => import('./views/shifts.js'), true, true],
  ['/app/stats', () => import('./views/stats.js'), true, 'reports'],
  ['/app/interpretation', () => import('./views/interpretation.js'), true, 'reports'],
  ['/app/contract', () => import('./views/contract.js'), true, 'manager'],
  ['/app/evaluation', () => import('./views/evaluation.js'), true, 'reports'],
  ['/app/glossary', () => import('./views/glossary.js'), true],
  ['/app/rooms', () => import('./views/rooms.js'), true],
  ['/app/meet/:kind/:id', () => import('./views/meet.js'), true],
  ['/app/revise/:material', () => import('./views/revise.js'), true, true]
];

// مسارُ كل شاشةٍ وصلاحيتُها (ملاحظة ١٧٢)
const PERM_OF = {
  '/app/new': 'materials',
  '/app/staff': 'team', '/app/staff/admins': 'team', '/app/team': 'team', '/app/field': 'team',
  '/app/cards': 'cards',
  '/app/payroll': 'payroll',
  '/app/bank-accounts': 'banks',
  '/app/shifts': 'shifts',
  '/app/evaluation': 'evaluation',
  '/app/interpretation': 'interpretation',
  '/app/languages': 'settings', '/app/khateebs': 'settings', '/app/workflow': 'settings',
  '/app/stats': 'reports', '/app/archive': 'reports'
};

function match(path) {
  // الصفحات ذات الملفات المستقلة (بطاقة الرابط) قد تُفتح بامتدادها، فتُعامل معاملة مسارها (ملاحظة ١٤٠)
  path = path.replace(/\.html$/, '') || '/';
  for (const [pattern, load, needsAuth, adminOnly] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    const m = path.match(re);
    if (m) return { load, needsAuth, adminOnly, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  if (auth.session) idleStart();
render();
}
window.addEventListener('popstate', () => render());
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/assets') || url.pathname.startsWith('/vendor')) return;
  // رابط داخل الصفحة نفسها (#قسم): تمرير إليه بلا إعادة رسم
  if (url.hash && url.pathname === location.pathname) {
    const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (el) {
      e.preventDefault();
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    return;
  }
  e.preventDefault();
  navigate(url.pathname + url.search);
});

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const root = document.getElementById('app');
  const path = location.pathname;

  if (!configured) { root.replaceChildren(setupNotice()); return; }

  // نطاق المنصة يفتح على صفحة الدخول، ونطاق البث لا يخدم مسارات المنصة (ملاحظة ٥٥)
  const cfg = window.HS_CONFIG || {};
  const here = location.hostname;
  // مدخل واحد للعاملين: لا شاشة «اختر وجهتك»؛ الدور هو من يحدد الوجهة (ملاحظة ٥٦)
  if (cfg.platformHost && here === cfg.platformHost && (path === '/' || path === '/start')) return navigate('/app', { replace: true });
  if (cfg.publicHost && here === cfg.publicHost && cfg.platformHost && /^\/(app|start|login|register|reset)(\/|$)/.test(path)) {
    location.href = `https://${cfg.platformHost}${path}${location.search}`;
    return;
  }

  const route = match(path);
  if (!route) { root.replaceChildren(notFound()); return; }

  try {
    // الموقع العام يعمل من أرشيف يوتيوب وحده: تعذُّر الوصول إلى الخادم لا يمنع عرضه
    if (route.needsAuth) await loadReference();
    else await loadReference().catch(() => {});
    if (route.needsAuth) {
      if (!auth.session) return navigate('/login?next=' + encodeURIComponent(path), { replace: true });
      if (!state.profile) await loadProfile();
      if (!state.profile) { await auth.signOut(); return navigate('/login', { replace: true }); }
      if (!isActive()) {
        const { pending } = await import('./views/auth.js');
        if (seq === renderSeq) root.replaceChildren(await pending());
        return;
      }
      // التحقق بخطوتين قبل كل شيء: إلزامي للإدارة، ولازم لمن فعّله (ملاحظة ١٠٣)
      if (path !== '/mfa' && !(await loadMfaState())) {
        return navigate('/mfa?next=' + encodeURIComponent(path), { replace: true });
      }
      // لا وصول إلى مساحة العمل قبل التوقيع على ميثاق العمل (ملاحظتا ٥٧ و١٢٥)
      if (path !== '/policy' && path !== '/mfa' && !(await loadPolicyState())) return navigate('/policy', { replace: true });
      if (path === '/policy' && state.policySigned) return navigate('/app', { replace: true });
      // تعميم ملزم لم يُوقَّع: لا متابعة للمهام قبل الاطّلاع والتوقيع (ملاحظة ٨٩)
      if (path !== '/app/circulars' && path !== '/policy' && path !== '/mfa' && await loadCircularState()) {
        toast('لديك تعميم ملزم بانتظار اطّلاعك وتوقيعك.', 'bad');
        return navigate('/app/circulars', { replace: true });
      }
      // مدير المشروع من الهيئة يرى شاشات المنسق كلها اطّلاعًا، إلا ما يُنشئ أو يمسّ
      // الأجور والحسابات المصرفية، وإلا بنود العقد فهي لمدير المشروع (ملاحظتا ١٥٥ و١٦٤)
      const NOT_FOR_SUPERVISOR = ['/app/new', '/app/payroll', '/app/bank-accounts', '/app/circulars'];
      const supervisorMay = isSupervisor()
        && !NOT_FOR_SUPERVISOR.includes(path) && !path.startsWith('/app/revise');
      const mayView = route.adminOnly === 'manager' ? isManager() : isAdmin() || supervisorMay;
      if (route.adminOnly && !mayView) return navigate('/app', { replace: true });
      // قائمة الصلاحيات: ما أُغلق على الحساب لا يُفتح ولو كُتب مساره (ملاحظة ١٧٢)
      const need = PERM_OF[path] || (path.startsWith('/app/revise') ? 'materials' : null);
      if (need && !can(need)) {
        toast('هذه الشاشة مغلقة على حسابك — راجع مدير المشروع.', 'bad');
        return navigate('/app', { replace: true });
      }
      if (isSupervisor() && NOT_FOR_SUPERVISOR.includes(path)) return navigate('/app', { replace: true });
      if (isSupervisor()) db.rpc('log_supervisor_view', { p_screen: path }).catch(() => {});
    }
    const mod = await route.load();
    document.title = DEFAULT_TITLE;
    const ctx = { params: route.params, query: new URLSearchParams(location.search), navigate };
    const view = await mod.render(ctx);
    if (seq !== renderSeq) return;
    root.replaceChildren(route.needsAuth && path !== '/policy' && path !== '/mfa' ? staffShell(view, path) : view);
    const main = document.getElementById('main');
    if (main && !path.startsWith('/app/tasks/')) window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (seq !== renderSeq) return;
    root.replaceChildren(errorView(err));
  }
}

function setupNotice() {
  return h('div.auth-wrap', h('div.card.auth-card',
    h('h2', 'الإعداد لم يكتمل'),
    h('p', 'افتح ملف config.js وضع فيه رابط مشروع Supabase ومفتاح anon، ثم أعد تحميل الصفحة.'),
    h('p.muted.small', 'المفتاحان علنيان بطبيعتهما. لا تضع مفتاح service_role في هذا الملف أبدًا.')));
}
function notFound() {
  return h('div.auth-wrap', h('div.card.auth-card', h('h2', 'الصفحة غير موجودة'), h('a.btn', { href: '/' }, 'العودة للرئيسية')));
}
function errorView(err) {
  return h('div.auth-wrap', h('div.card.auth-card',
    h('h2', 'تعذّر عرض الصفحة'), h('p', err.message || String(err)),
    h('div.row', h('button.btn.primary', { onclick: () => render() }, 'إعادة المحاولة'), h('a.btn', { href: '/' }, 'الرئيسية'))));
}

// السمة: تتبع النظام افتراضيًا، ويمكن تثبيتها
try { const t = localStorage.getItem('hs.theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* */ }

// تغيّر الجلسة (خروج، انتهاء) يعيد التحقق
auth.onChange(s => { if (s) idleStart(); else idleStop();
  if (!s) { state.profile = null; state.policySigned = false; state.policyLoaded = false;
  state.blockingCirculars = 0; state.circularsLoaded = false; state.mfaLoaded = false; state.mfaOk = true; if (location.pathname.startsWith('/app')) navigate('/login', { replace: true }); } });

// روابط البريد (تأكيد الحساب أو استعادة كلمة المرور)
const fromEmail = configured ? auth.consumeUrlTokens() : null;
if (fromEmail?.error) setTimeout(() => toast(fromEmail.error, 'bad'), 300);
if (fromEmail?.type === 'recovery') history.replaceState(null, '', '/reset');
else if (fromEmail?.type === 'signup') { history.replaceState(null, '', '/app'); setTimeout(() => toast('تم تأكيد بريدك.', 'ok'), 300); }

if (auth.session) idleStart();
render();
export { render };
