import { auth, configured } from './sb.js';
import { h, toast } from './ui.js';
import { state, loadProfile, loadReference, loadPolicyState, loadCircularState, isAdmin, isActive } from './store.js';
import { staffShell } from './views/shell.js';

const DEFAULT_TITLE = document.title;

const routes = [
  // [النمط، الاستيراد، يتطلب دخولًا، للإدارة فقط]
  ['/', () => import('./views/public.js'), false],
  ['/arafah', () => import('./views/public.js').then(m => ({ render: m.arafah })), false],
  ['/about', () => import('./views/about.js'), false],
  ['/initiative', () => import('./views/about.js').then(m => ({ render: m.initiative })), false],
  ['/policy', () => import('./views/policy.js'), true],
  ['/login', () => import('./views/auth.js').then(m => ({ render: m.login })), false],
  ['/register', () => import('./views/auth.js').then(m => ({ render: m.register })), false],
  ['/reset', () => import('./views/auth.js').then(m => ({ render: m.reset })), false],
  ['/app', () => import('./views/home.js'), true],
  ['/app/tasks', () => import('./views/tasks.js').then(m => ({ render: m.list })), true],
  ['/app/tasks/:id', () => import('./views/tasks.js').then(m => ({ render: m.workspace })), true],
  ['/app/new', () => import('./views/new-material.js'), true, true],
  ['/app/team', () => import('./views/team.js'), true, true],
  ['/app/languages', () => import('./views/languages.js'), true, true],
  ['/app/khateebs', () => import('./views/khateebs.js'), true, true],
  ['/app/workflow', () => import('./views/workflow.js'), true, true],
  ['/app/archive', () => import('./views/archive.js'), true, true],
  ['/app/circulars', () => import('./views/circulars.js'), true],
  ['/app/me', () => import('./views/me.js'), true],
  ['/app/bank-accounts', () => import('./views/bank.js').then(m => ({ render: m.adminList })), true, true],
  ['/app/cards', () => import('./views/cards.js'), true, true],
  ['/app/stats', () => import('./views/stats.js'), true, true],
  ['/app/revise/:material', () => import('./views/revise.js'), true, true]
];

function match(path) {
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
      // لا وصول إلى مساحة العمل قبل التوقيع على سياسة السرية (ملاحظة ٥٧)
      if (path !== '/policy' && !(await loadPolicyState())) return navigate('/policy', { replace: true });
      if (path === '/policy' && state.policySigned) return navigate('/app', { replace: true });
      // تعميم ملزم لم يُوقَّع: لا متابعة للمهام قبل الاطّلاع والتوقيع (ملاحظة ٨٩)
      if (path !== '/app/circulars' && path !== '/policy' && await loadCircularState()) {
        toast('لديك تعميم ملزم بانتظار اطّلاعك وتوقيعك.', 'bad');
        return navigate('/app/circulars', { replace: true });
      }
      if (route.adminOnly && !isAdmin()) return navigate('/app', { replace: true });
    }
    const mod = await route.load();
    document.title = DEFAULT_TITLE;
    const ctx = { params: route.params, query: new URLSearchParams(location.search), navigate };
    const view = await mod.render(ctx);
    if (seq !== renderSeq) return;
    root.replaceChildren(route.needsAuth && path !== '/policy' ? staffShell(view, path) : view);
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
auth.onChange(s => { if (!s) { state.profile = null; state.policySigned = false; state.policyLoaded = false;
  state.blockingCirculars = 0; state.circularsLoaded = false; if (location.pathname.startsWith('/app')) navigate('/login', { replace: true }); } });

// روابط البريد (تأكيد الحساب أو استعادة كلمة المرور)
const fromEmail = configured ? auth.consumeUrlTokens() : null;
if (fromEmail?.error) setTimeout(() => toast(fromEmail.error, 'bad'), 300);
if (fromEmail?.type === 'recovery') history.replaceState(null, '', '/reset');
else if (fromEmail?.type === 'signup') { history.replaceState(null, '', '/app'); setTimeout(() => toast('تم تأكيد بريدك.', 'ok'), 300); }

render();
export { render };
