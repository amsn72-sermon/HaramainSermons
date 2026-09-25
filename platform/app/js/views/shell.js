import { h } from '../ui.js';
import { auth, db } from '../sb.js';
import { state, isAdmin, isManager, ROLE_LABEL } from '../store.js';

export function themeToggle() {
  // الداكن هو الأصل كما في النسخة الأولى
  const current = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const label = () => current() === 'dark' ? '☀ المظهر الفاتح' : '☾ المظهر الداكن';
  const btn = h('button.btn.sm', { type: 'button', onclick: () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hs.theme', next); } catch { /* */ }
    btn.textContent = label();
  } }, label());
  return btn;
}

// شعار الهيئة | شعار الرئاسة، ثم اسم المنصة — كما في النسخة الأولى
export function brand(title = 'إدارة ترجمة الحرمين', sub = 'مشروع خادم الحرمين الشريفين للترجمة', href = '/app') {
  return h('a.brand', { href },
    h('div.identity-logos',
      h('img.authority', { src: '/assets/alharamain-logo.png', alt: 'الحرمين — الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي', width: 94, height: 50 }),
      h('span.sep', { 'aria-hidden': 'true' }),
      h('img.presidency', { src: '/assets/presidency.png', alt: 'رئاسة الشؤون الدينية بالمسجد الحرام والمسجد النبوي', width: 75, height: 50 })),
    h('div.brand-copy', h('b', title), sub && h('span', sub)));
}

export function footer(left = 'إدارة ترجمة الحرمين الشريفين', right = 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي') {
  return h('footer.site', h('div.inner', h('span', left), h('span', right)));
}

// سياسة السرية حاضرة دائمًا: أخضر إن وُقّعت وأحمر إن لم تُوقّع (ملاحظة ٧٦)
export function policyChip() {
  const chip = h('button.btn.sm.policy-chip', { type: 'button', title: 'سياسة السرية التامة' });
  const paint = () => {
    const ok = !!state.policySigned;
    chip.className = 'btn sm policy-chip ' + (ok ? 'signed' : 'unsigned');
    chip.replaceChildren(h('span.dot', { 'aria-hidden': 'true' }), 'سياسة السرية');
    chip.setAttribute('aria-label', ok ? 'سياسة السرية — موقّعة' : 'سياسة السرية — لم تُوقّع بعد');
  };
  chip.onclick = async () => {
    const m = await import('./policy.js');
    if (await m.policyDialog()) paint();
  };
  paint();
  return chip;
}

export function staffShell(view, path) {
  const p = state.profile;
  const link = (href, text) => h('a', { href, 'aria-current': (href === path || (href !== '/app' && path.startsWith(href + '/'))) ? 'page' : null }, text);
  // ترتيب القائمة كما في النسخة الأولى
  const mail = link('/app/circulars', 'المراسلات');
  const mine = link('/app/me', 'بياناتي');
  const nav = isAdmin()
    ? [link('/app', 'المتابعة'), link('/app/new', 'إضافة مادة'), link('/app/team', 'فريق العمل'),
       link('/app/cards', 'بطاقات العمل'), link('/app/bank-accounts', 'الحسابات البنكية'),
       link('/app/languages', 'اللغات'), link('/app/archive', 'أرشيف الترجمة'),
       link('/app/workflow', 'إعداد سير العمل'), link('/app/tasks', 'مهامي'), mail, mine,
       link('/app/khateebs', 'الخطباء')]
    : [link('/app/tasks', 'مهامي'), mail, mine];
  // شارة ما لم يُوقَّع عليه بالعلم
  db.rpc('my_pending_circulars').then(n => {
    const count = Number(Array.isArray(n) ? n[0] : n) || 0;
    if (count > 0) mail.append(h('span.nav-badge', String(count)));
  }).catch(() => {});

  return h('div',
    h('header.topbar', h('div.inner',
      brand(),
      h('div.spacer'),
      h('div.who', p.full_name, h('small', ROLE_LABEL[p.role])),
      themeToggle(),
      policyChip(),
      h('button.btn.sm', { type: 'button', onclick: () => auth.signOut() }, 'خروج'))),
    h('div.layout',
      h('nav.sidenav', { 'aria-label': 'التنقل' }, nav),
      h('main#main', { tabindex: '-1' }, view)),
    footer());
}
