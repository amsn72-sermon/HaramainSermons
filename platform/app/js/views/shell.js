import { h } from '../ui.js';
import { auth, db } from '../sb.js';
import { state, isAdmin, isManager, isSupervisor, isViewer, isWatcher, can, roleLabel, isTeamLead } from '../store.js';

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

// شاشةُ كلِّ صلاحية: ما أُغلق منها لا يظهر في القائمة أصلًا (ملاحظة ١٧٢)
const NAV_PERM = {
  '/app/new': 'mat_add',
  '/app/staff': 'tm_view', '/app/staff/admins': 'tm_view',
  '/app/field': 'tm_view', '/app/answers': 'tm_view',
  '/app/cards': 'cards', '/app/payroll': 'pay_view', '/app/bank-accounts': 'bank_view',
  '/app/shifts': 'sh_view', '/app/sites': 'sh_sites', '/app/evaluation': 'evaluation',
  '/app/interpretation': 'interpretation',
  '/app/certificates': 'certs',
  '/app/languages': 'st_languages', '/app/khateebs': 'st_khateebs',
  '/app/workflow': 'st_workflow',
  '/app/glossary': 'glossary', '/app/glossary/watch': 'glossary',
  '/app/contract': 'ctr_view',
  '/app/circulars': 'circ_read',
  '/app/stats': 'rp_stats', '/app/archive': 'rp_archive'
};

export function staffShell(view, path) {
  const p = state.profile;
  const link = (href, text) => (NAV_PERM[href] && !can(NAV_PERM[href])) ? null
    : h('a', { href, 'aria-current': (href === path || (href !== '/app' && path.startsWith(href + '/'))) ? 'page' : null }, text);
  // القائمة مرتَّبة بمسار العمل: من إدخال المادة إلى أرشفتها، ثم الفريق،
  // ثم المراسلات، ثم الإعدادات المرجعية، وآخرها حساب العضو نفسه (ملاحظة ٩٢)
  const mail = link('/app/circulars', 'المراسلات');
  const mine = link('/app/me', 'بياناتي');

  // المجموعاتُ تُطوى وتُفتح، فتقصُر القائمةُ من ثلاثين رابطًا إلى ستة
  // عناوين. ويُحفظ ما فُتح فلا يُعاد في كل دخول (ملاحظة ٢٦٨)
  const NAV_OPEN = 'hs.nav.open';
  const openSet = () => {
    try { return new Set(JSON.parse(localStorage.getItem(NAV_OPEN) || '[]')); }
    catch { return new Set(); }
  };
  const remember = (title, on) => {
    try {
      const s = openSet();
      if (on) s.add(title); else s.delete(title);
      localStorage.setItem(NAV_OPEN, JSON.stringify([...s]));
    } catch { /* المتصفحُ قد يمنع الحفظ، ولا يضرّ */ }
  };
  const saved = openSet();

  // وحدةٌ داخل مجموعة: عنوانٌ باهتٌ لا مفتاحُ طيٍّ ثانٍ — فطبقتان تكفيان
  const unit = (title, links) => {
    const list = (Array.isArray(links) ? links : [links]).filter(Boolean);
    return list.length ? [title ? h('span.nav-unit', title) : null, ...list].filter(Boolean) : [];
  };
  const group = (title, links, opts = {}) => {
    const list = (Array.isArray(links) ? links : [links]).flat().filter(Boolean);
    if (!list.length) return null;
    // المجموعةُ تُفتح من نفسها إن كانت الصفحةُ المعروضةُ من بنودها
    const here = list.some(el => el?.getAttribute?.('aria-current') === 'page');
    const open = here || (saved.has(title) || (!saved.size && opts.open));
    const box = h('details.nav-group', { open: open || null },
      h('summary.nav-head', title), ...list);
    box.addEventListener('toggle', () => remember(title, box.open));
    return box;
  };
  // روابط موقع البث العام داخل المنصة: تُفتح في صفحة جديدة (ملاحظة ١٠٤)
  const cfg = window.HS_CONFIG || {};
  const pub = cfg.publicHost ? `https://${cfg.publicHost}` : '';
  const out = (to, text) => h('a.nav-out', { href: pub + to, target: '_blank', rel: 'noopener' },
    text, h('span.ext', { 'aria-hidden': 'true' }, '↗'));
  const broadcast = group('موقع البث', [
    out('/', 'بث الخطب'),
    out('/?tab=archive', 'أرشيف الخطب والمجالس'),
    out('/arafah', 'خطب عرفة')]);
  // ---------------------------------------------------------------------
  // القائمةُ في وحداتٍ متشابهة، تُطوى وتُفتح (ملاحظة ٢٦٨)
  // ---------------------------------------------------------------------
  const flow = extra => group('سير العمل', [
    link('/app', 'المتابعة'),
    ...(extra || []),
    link('/app/repo', 'مستودع الترجمة'),
    link('/app/archive', 'أرشيف الترجمة'),
    link('/app/stats', 'دليل الإنتاج'),
    link('/app/interpretation', 'الترجمة الفورية')], { open: true });

  const teamGroup = ({ pay = false, circ = false } = {}) => group('الفريق', [
    unit('الأعضاء', [
      link('/app/staff/admins', 'الحسابات الإدارية'),
      link('/app/staff', 'المترجمون المتخصصون'),
      link('/app/field', 'المرشدون المكانيون'),
      link('/app/answers', 'إجابة السائلين'),
      link('/app/cards', 'بطاقات العمل')]),
    unit('الميدان', [
      link('/app/shifts', 'الحضور والانصراف'),
      link('/app/sites', 'مواقع العمل'),
      link('/app/evaluation', 'تقييم المرشدين'),
      link('/app/rooms', 'القاعات واللقاءات')]),
    unit('شؤون الأعضاء', [
      pay ? link('/app/payroll', 'الرواتب') : null,
      link('/app/charter', 'ميثاق العمل'),
      link('/app/certificates', 'الشهادات'),
      link('/app/training', 'التدريب والتأهيل'),
      circ ? mail : null])]);

  const termsGroup = group('المصطلحات', [
    link('/app/glossary', 'الدليل الإرشادي'),
    link('/app/glossary/watch', 'مرصد المصطلحات'),
    link('/app/audio-guide', 'دليل التسجيل الصوتي')]);

  const settingsGroup = group('الإعدادات', [
    link('/app/languages', 'اللغات'),
    link('/app/khateebs', 'الخطباء'),
    link('/app/workflow', 'إعداد سير العمل'),
    isManager() ? link('/app/roles', 'تسميات الأدوار') : null]);

  const mineGroup = (extra = []) => group('حسابي',
    [mine, link('/app/attend', 'حضوري'), link('/app/my-certificates', 'شهاداتي'),
     ...extra, link('/about', 'عن المنصة')], { open: true });

  const nav = isWatcher()
    // مديرُ المشروع من الهيئة وحساباتُ المتابعة: يرون ما يراه المنسق،
    // بلا إنشاءٍ ولا تعديل، وبلا الرواتب ولا الحسابات ولا المراسلات
    // (ملاحظات ١٤٦ و١٦٤ و٢٧١)
    ? [flow(), teamGroup(), termsGroup, settingsGroup, broadcast, mineGroup()]
    : isAdmin()
    ? [flow([
         link('/app/new', 'إضافة مادة'),
         link('/app/tasks', 'مهامي'),
         can('contract') ? link('/app/contract', 'بنود العقد والمستخلص') : null]),
       teamGroup({ pay: can('payroll'), circ: true }),
       termsGroup, settingsGroup, broadcast, mineGroup()]
    : ['field', 'answers'].includes(p.track) && !p.may_translate
      // الإرشاد وإجابة السائلين: لا تُسنَد إليهما ترجمة، فلا قائمة مهام
      // (ملاحظتا ٩٩ و١٨٦)
      ? [group('عملي', [link('/app/rooms', 'القاعات واللقاءات'),
           link('/app/training', 'التدريب والتأهيل'),
           isTeamLead() ? link('/app/sites', 'فريقي ومواقعه') : null], { open: true }),
         broadcast, mineGroup([mail])]
      : [group('عملي', [link('/app/tasks', 'مهامي'), mail,
           link('/app/rooms', 'القاعات واللقاءات'),
           link('/app/training', 'التدريب والتأهيل'),
           isTeamLead() ? link('/app/sites', 'فريقي ومواقعه') : null], { open: true }),
         termsGroup, broadcast, mineGroup()];
  // شارة ما لم يُوقَّع عليه بالعلم
  if (mail) db.rpc('my_pending_circulars').then(n => {
    const count = Number(Array.isArray(n) ? n[0] : n) || 0;
    if (count > 0) mail.append(h('span.nav-badge', String(count)));
  }).catch(() => {});

  // أثرُ الاطّلاع: المتابعُ يرى البيانات، ويَحسُن أن يُعلم من رآها
  // (ملاحظة ٢٧١ و)
  if (isViewer() || isSupervisor()) db.rpc('log_view', { p_page: path }).catch(() => {});

  // في الجوال تُطوى القائمة خلف زر، فلا تسبق المحتوى بجدار روابط (ملاحظة ١٠٦)
  const navEl = h('nav#sidenav.sidenav', { 'aria-label': 'التنقل' }, nav.filter(Boolean));
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
      h('div.who', p.full_name, h('small', roleLabel(p))),
      themeToggle(),
      policyChip(),
      h('button.btn.sm', { type: 'button', onclick: () => auth.signOut() }, 'خروج'))),
    h('div.layout', navEl, h('main#main', { tabindex: '-1' }, view)),
    footer());
}
