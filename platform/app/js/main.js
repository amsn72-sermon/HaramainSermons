import { auth, configured } from './sb.js';
import { h, toast } from './ui.js';
import { state, loadProfile, loadReference, isAdmin, isActive } from './store.js';
import { staffShell } from './views/shell.js';

const routes = [
  // [النمط، الاستيراد، يتطلب دخولًا، للإدارة فقط]
  ['/', () => import('./views/public.js'), false],
  ['/start', () => import('./views/start.js'), false],
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
  ['/app/archive', () => import('./views/archive.js'), true, true]
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
  e.preventDefault();
  navigate(url.pathname + url.search);
});

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const root = document.getElementById('app');
  const path = location.pathname;

  if (!configured) { root.replaceChildren(setupNotice()); return; }

  const route = match(path);
  if (!route) { root.replaceChildren(notFound()); return; }

  try {
    await loadReference();
    if (route.needsAuth) {
      if (!auth.session) return navigate('/login?next=' + encodeURIComponent(path), { replace: true });
      if (!state.profile) await loadProfile();
      if (!state.profile) { await auth.signOut(); return navigate('/login', { replace: true }); }
      if (!isActive()) {
        const { pending } = await import('./views/auth.js');
        if (seq === renderSeq) root.replaceChildren(await pending());
        return;
      }
      if (route.adminOnly && !isAdmin()) return navigate('/app', { replace: true });
    }
    const mod = await route.load();
    const ctx = { params: route.params, query: new URLSearchParams(location.search), navigate };
    const view = await mod.render(ctx);
    if (seq !== renderSeq) return;
    root.replaceChildren(route.needsAuth ? staffShell(view, path) : view);
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
auth.onChange(s => { if (!s) { state.profile = null; if (location.pathname.startsWith('/app')) navigate('/start', { replace: true }); } });

// روابط البريد (تأكيد الحساب أو استعادة كلمة المرور)
const fromEmail = configured ? auth.consumeUrlTokens() : null;
if (fromEmail?.error) setTimeout(() => toast(fromEmail.error, 'bad'), 300);
if (fromEmail?.type === 'recovery') history.replaceState(null, '', '/reset');
else if (fromEmail?.type === 'signup') { history.replaceState(null, '', '/app'); setTimeout(() => toast('تم تأكيد بريدك.', 'ok'), 300); }

render();
export { render };
