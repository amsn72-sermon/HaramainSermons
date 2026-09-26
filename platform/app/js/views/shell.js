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

// ميثاق العمل حاضر دائمًا: أخضر إن وُقّع وأحمر إن لم يُوقَّع (ملاحظتا ٧٦ و١٢٥)
export function policyChip() {
  const chip = h('button.btn.sm.policy-chip', { type: 'button', title: 'ميثاق العمل' });
  const paint = () => {
    const ok = !!state.policySigned;
    chip.className = 'btn sm policy-chip ' + (ok ? 'signed' : 'unsigned');
    chip.replaceChildren(h('span.dot', { 'aria-hidden': 'true' }), 'ميثاق العمل');
    chip.setAttribute('aria-label', ok ? 'ميثاق العمل — موقَّع' : 'ميثاق العمل — لم يُوقَّع بعد');
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
  // القائمة مرتَّبة بمسار العمل: من إدخال المادة إلى أرشفتها، ثم الفريق،
  // ثم المراسلات، ثم الإعدادات المرجعية، وآخرها حساب العضو نفسه (ملاحظة ٩٢)
  const mail = link('/app/circulars', 'المراسلات');
  const mine = link('/app/me', 'بياناتي');
  const group = (title, links) => h('div.nav-group', h('span.nav-head', title), links);
  // روابط موقع البث العام داخل المنصة: تُفتح في صفحة جديدة (ملاحظة ١٠٤)
  const cfg = window.HS_CONFIG || {};
  const pub = cfg.publicHost ? `https://${cfg.publicHost}` : '';
  const out = (to, text) => h('a.nav-out', { href: pub + to, target: '_blank', rel: 'noopener' },
    text, h('span.ext', { 'aria-hidden': 'true' }, '↗'));
  const broadcast = group('موقع البث', [
    out('/', 'بث الخطب'),
    out('/?tab=archive', 'أرشيف الخطب والمجالس'),
    out('/arafah', 'خطب عرفة')]);
  const nav = isAdmin()
    ? [group('سير العمل', [
         link('/app', 'المتابعة'),
         link('/app/new', 'إضافة مادة'),
         link('/app/tasks', 'مهامي'),
         link('/app/archive', 'أرشيف الترجمة'),
         link('/app/stats', 'دليل الإنتاج')]),
       group('الفريق', [
         link('/app/staff/admins', 'الحسابات الإدارية'),
         link('/app/staff', 'المترجمون المتخصصون'),
         link('/app/field', 'المرشدون المكانيون'),
         link('/app/cards', 'بطاقات العمل'),
         link('/app/charter', 'ميثاق العمل'),
         link('/app/payroll', 'الرواتب'),
         link('/app/shifts', 'الحضور والانصراف'),
         mail]),
       group('الإعدادات', [
         link('/app/languages', 'اللغات'),
         link('/app/khateebs', 'الخطباء'),
         link('/app/workflow', 'إعداد سير العمل')]),
       broadcast,
       group('حسابي', [mine, link('/about', 'عن المنصة')])]
    : p.track === 'field'
      // الإرشاد المكاني: لا تُسنَد إليه أعمال ترجمة، فلا قائمة مهام (ملاحظة ٩٩)
      ? [broadcast, group('حسابي', [mine, mail, link('/about', 'عن المنصة')])]
      : [group('عملي', [link('/app/tasks', 'مهامي'), mail]),
         broadcast,
         group('حسابي', [mine, link('/about', 'عن المنصة')])];
  // شارة ما لم يُوقَّع عليه بالعلم
  db.rpc('my_pending_circulars').then(n => {
    const count = Number(Array.isArray(n) ? n[0] : n) || 0;
    if (count > 0) mail.append(h('span.nav-badge', String(count)));
  }).catch(() => {});

  // في الجوال تُطوى القائمة خلف زر، فلا تسبق المحتوى بجدار روابط (ملاحظة ١٠٦)
  const navEl = h('nav#sidenav.sidenav', { 'aria-label': 'التنقل' }, nav);
  const navBtn = h('button.btn.sm.nav-toggle', { type: 'button', 'aria-controls': 'sidenav', 'aria-expanded': 'false' },
    h('span.bars', { 'aria-hidden': 'true' }, '☰'), 'القائمة');
  const setNav = on => {
    navEl.classList.toggle('open', on);
    navBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  navBtn.onclick = () => setNav(!navEl.classList.contains('open'));
  navEl.addEventListener('click', e => { if (e.target.closest('a')) setNav(false); });

  return h('div',
    h('header.topbar', h('div.inner',
      navBtn,
      brand(),
      h('div.spacer'),
      h('div.who', p.full_name, h('small', ROLE_LABEL[p.role])),
      themeToggle(),
      policyChip(),
      h('button.btn.sm', { type: 'button', onclick: () => auth.signOut() }, 'خروج'))),
    h('div.layout', navEl, h('main#main', { tabindex: '-1' }, view)),
    footer());
}
