// صفحة التعريف بالمنصة — محتواها في قاعدة البيانات خلف رمز اطّلاع (ملاحظتا ٨٨ و٩١)
// لا نص هنا: يُجلب بعد التحقق، فلا يقرؤه من لا إذن له من ملفات الواجهة.
import { h, toast, busy, dialog } from '../ui.js';
import { db, auth } from '../sb.js';
import { state, isManager, loadProfile } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';

const readCode = key => { try { return sessionStorage.getItem('hs-page-' + key) || ''; } catch { return ''; } };
const keepCode = (key, v) => { try { sessionStorage.setItem('hs-page-' + key, v); } catch { /* وضع تصفّح خاص */ } };

function shell(inner, extra, wide) {
  return h('div',
    h('header.topbar', h('div.inner',
      brand('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'ترجمات بلغات العالم', '/'),
      h('div.spacer'), extra, themeToggle())),
    h('main#main.wrap.public.about', { tabindex: '-1', class: wide ? 'wide-type' : '' }, inner),
    footer('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين',
      'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'));
}

// ---------------------------------------------------------------------
// بوابة الرمز
// ---------------------------------------------------------------------
function gate(key, title, onOpen) {
  const code = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'رمز الاطّلاع' });
  const err = h('div.form-errors', { hidden: true, role: 'alert' });
  const go = h('button.btn.primary', { type: 'submit' }, 'عرض الصفحة');
  const form = h('form.stack', { novalidate: true, onsubmit: e => {
    e.preventDefault();
    busy(go, async () => {
      const v = code.value.trim();
      if (!v) { err.textContent = 'اكتب رمز الاطّلاع.'; err.hidden = false; return; }
      try {
        const data = await db.rpc('open_page', { p_key: key, p_code: v });
        keepCode(key, v);
        onOpen(data);
      } catch (e2) {
        err.textContent = /REQUIRE_CODE/.test(e2.message) ? 'اكتب رمز الاطّلاع.' : e2.message;
        err.hidden = false;
      }
    });
  } },
    h('h2', title),
    err,
    h('label.field', 'رمز الاطّلاع', code),
    go,
    h('a.small', { href: '/login' }, 'الدخول إلى المنصة'));
  return h('div.card.auth-card', form);
}

// ---------------------------------------------------------------------
// رسم الصفحة من المحتوى المجلوب
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// رسوم توضيحية: تُرسم بألوان المظهر نفسه فتظهر في الداكن والفاتح وفي الطباعة
// ---------------------------------------------------------------------
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
};
const sText = (x, y, str, cls = '') => svg('text', { x, y, class: cls, 'text-anchor': 'middle' }, document.createTextNode(str));

// دورة المادة: إدخال ← لغات ← إسناد ← مراحل ← اعتماد ← أرشيف
function cycleDiagram() {
  const steps = [['1', 'إدخال المادة', 'الأصل وبياناته'], ['2', 'تحديد اللغات', 'مسار لكل لغة'],
    ['3', 'الإسناد والمواعيد', 'مسؤول لكل مرحلة'], ['4', 'المراحل الست', 'ترجمة ومراجعات'],
    ['5', 'الاعتماد', 'مدير المشروع'], ['6', 'الأرشيف', 'جاهزة للتسليم']];
  return h('div.fig',
    h('ol.fig-flow', steps.map(([n, title, sub]) =>
      h('li.fig-node', h('span.fig-num', n), h('b', title), h('span', sub)))),
    h('p.fig-cap', 'دورة المادة من استلام الأصل إلى الأرشيف'));
}

// طبقات حماية المحتوى
function securityDiagram() {
  const layers = [
    ['الإقرار بالسرية', 'توقيع إلكتروني قبل استلام أي تكليف'],
    ['صلاحيات على مستوى قاعدة البيانات', 'لا يصل العضو إلا إلى ما صُرّح له به'],
    ['علامة مائية على الأصل', 'معرّف المستخدم وتاريخ الاطّلاع'],
    ['تقييد النسخ والتنزيل', 'العمل داخل بيئة المنصة'],
    ['روابط محدودة المدة', 'للوثائق الشخصية والمصرفية'],
    ['سجل اطّلاع وتتبّع', 'أثر يُرجع إليه عند المراجعة']
  ];
  return h('div.fig',
    h('div.fig-layers', layers.map(([t, sub], i) =>
      h('div.fig-layer', { style: { '--i': i } }, h('b', t), h('span', sub)))),
    h('p.fig-cap', 'طبقات حماية المحتوى والبيانات'));
}

// الاستضافة: فصل الجمهور عن بيئة العمل، وكلاهما داخل الرياض
function hostingDiagram() {
  const W = 860, H = 300;
  const box = (x, y, w, hh, cls) => svg('rect', { x, y, width: w, height: hh, rx: 12, class: cls });
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fig-svg', role: 'img',
    'aria-label': 'مخطط الاستضافة: الموقع العام ومنصة العمل داخل مركز بيانات الرياض' },
    // إطار المملكة
    box(24, 40, W - 48, H - 76, 'fig-country'),
    sText(W - 120, 68, 'داخل المملكة — مركز بيانات الرياض', 'fig-country-label'),
    // المستفيدون
    box(W - 240, 100, 200, 60, 'fig-b'), sText(W - 140, 126, 'المستفيدون', 'fig-t'),
    sText(W - 140, 146, 'الموقع العام', 'fig-s'),
    // فريق العمل
    box(W - 240, 190, 200, 60, 'fig-b'), sText(W - 140, 216, 'فريق العمل', 'fig-t'),
    sText(W - 140, 236, 'منصة العمل — عنوان فرعي', 'fig-s'),
    // الخوادم
    box(300, 100, 230, 150, 'fig-b fig-core'),
    sText(415, 140, 'الخوادم وقاعدة البيانات', 'fig-t'), sText(415, 162, 'والملفات', 'fig-t'),
    sText(415, 196, 'اتصال مشفّر', 'fig-s'), sText(415, 220, 'مكوّنات مفتوحة المصدر', 'fig-s'),
    // النسخ الاحتياطية
    box(70, 140, 180, 70, 'fig-b'), sText(160, 168, 'نسخ احتياطية يومية', 'fig-t'),
    sText(160, 190, 'مشفّرة داخل المنطقة', 'fig-s'),
    // الأسهم
    svg('path', { d: `M ${W - 240} 130 H 530`, class: 'fig-arrow' }),
    svg('path', { d: `M ${W - 240} 220 H 530`, class: 'fig-arrow' }),
    svg('path', { d: 'M 300 175 H 250', class: 'fig-arrow' }));
  return h('div.fig', g, h('p.fig-cap', 'فصل الموقع العام عن بيئة العمل، والبيانات كلها داخل المملكة'));
}

// التغطية اللغوية
function languagesDiagram() {
  return h('div.fig',
    h('div.fig-langs',
      h('div.fig-ring', h('b', '50'), h('span', 'لغة ترجمة')),
      h('div.fig-langs-body',
        h('div.fig-chip', h('b', '13'), h('span', 'لغة رئيسية تُختار مجموعةً واحدة عند الإسناد')),
        h('div.fig-chip', h('b', '37'), h('span', 'لغة إضافية تُفعَّل بحسب حاجة العمل')),
        h('div.fig-chip.ar', h('b', 'العربية'), h('span', 'لغة الأصل، ولا تُعدّ لغة ترجمة')))),
    h('p.fig-cap', 'التغطية اللغوية في المنصة'));
}

const DIAGRAMS = { cycle: cycleDiagram, security: securityDiagram, hosting: hostingDiagram, languages: languagesDiagram };

// ---------------------------------------------------------------------
// رسم الصفحة من المحتوى المجلوب
// ---------------------------------------------------------------------
function page(d) {
  const block = ([kind, val]) => {
    if (kind === 'p') return h('p', val);
    if (kind === 'h3') return h('h3.ab-h3', val);
    if (kind === 'ul') return h('ul.ab-list', val.map(t => h('li', t)));
    if (kind === 'callout') return h('div.ab-callout', h('span.ab-callout-mark', '!'), h('p', val));
    if (kind === 'cards') return h('div.ab-cards', val.map(([t, body]) =>
      h('article.ab-card', h('h3', t), h('p', body))));
    if (kind === 'diagram') return (DIAGRAMS[val] || (() => null))();
    if (kind === 'vision') return h('div.ab-vm',
      h('div.ab-vm-card', h('div.eyebrow', 'الرؤية'), h('p', d.vision)),
      h('div.ab-vm-card', h('div.eyebrow', 'الرسالة'), h('p', d.mission)));
    if (kind === 'goals') return h('ol.ab-goals', (d.goals || []).map((g, i) => {
      const [head, rest] = String(g).split(/:\s*/, 2).length > 1
        ? [String(g).slice(0, String(g).indexOf(':')), String(g).slice(String(g).indexOf(':') + 1).trim()]
        : [null, g];
      return h('li', h('span.ab-goal-num', String(i + 1)),
        h('div', head && h('b', head), h('p', rest)));
    }));
    if (kind === 'stagenames') return h('div.fig',
      h('ol.ab-chips', (d.stages || []).map(([name], i) =>
        h('li', h('span.ab-chip-num', String(i + 1)), name))),
      h('p.fig-cap', 'المسار القياسي لكل لغة'));
    if (kind === 'stages') return h('div.fig',
      h('ol.ab-stages', (d.stages || []).map(([name, who, task], i) =>
        h('li', h('span.ab-step', String(i + 1)),
          h('div', h('b', name), h('span.ab-who', who), h('p', task))))),
      h('p.fig-cap', 'المسار القياسي: ست مراحل، لكل مرحلة مسؤول ومهمة'));
    if (kind === 'roles') return h('div.ab-roles', (d.roles || []).map(([name, items]) =>
      h('div.ab-role', h('h3', name), items.map(t => h('p', t)))));
    return null;
  };

  const secEl = ([id, title, blocks]) => h('section.ab-sec', { id }, h('h2', title), blocks.map(block));

  const many = (d.sections || []).length > 2;
  const toc = many ? h('nav.ab-toc', { 'aria-label': 'محتويات الصفحة' },
    h('b', 'المحتويات'),
    h('ol', d.sections.map(([id, title]) => h('li', h('a', { href: `#${id}` }, title))))) : null;

  return h('div',
    h('section.hero.ab-hero',
      h('div.ab-badge', d.badge),
      h('h1', d.h1),
      h('p', d.lead),
      h('div.ab-stats', (d.stats || []).map(([n, label]) => h('div.ab-stat', h('b', n), h('span', label))))),
    h('div.ab-body', { class: many ? '' : 'solo' }, toc, h('div.ab-main', (d.sections || []).map(secEl))),
    d.note ? h('p.ab-foot-note', d.note) : null);
}

// تغيير رمز الاطّلاع — لمدير المشروع
function codeBtn(key) {
  const btn = h('button.btn.sm', { type: 'button' }, 'رمز الاطّلاع');
  btn.onclick = async () => {
    const code = h('input', { type: 'text', autocomplete: 'off', placeholder: 'اتركه فارغًا لفتح الصفحة للجميع' });
    const res = await dialog({
      title: 'رمز الاطّلاع على صفحة التعريف',
      body: h('div.stack',
        h('p.small.muted', 'يُعطى هذا الرمز لمن تريد اطّلاعه من المسؤولين. وأعضاء المنصة المفعّلون يرونها بلا رمز.'),
        h('label.field', 'الرمز الجديد', h('small', 'أربعة محارف فأكثر'), code)),
      buttons: [{ label: 'حفظ', kind: 'primary', value: () => code.value }, { label: 'إلغاء', value: null }]
    });
    if (res === null) return;
    try {
      await db.rpc('set_page_code', { p_key: key, p_code: res.trim() || null });
      toast(res.trim() ? 'حُفظ رمز الاطّلاع.' : 'صارت الصفحة مفتوحة للجميع.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };
  return btn;
}

async function view({ key, title, login = false, wide = false }) {
  // الصفحة عامة، فالملف الشخصي لا يُحمَّل تلقائيًّا: نحمّله ليظهر زر الرمز للمدير
  if (auth.session && !state.profile) await loadProfile().catch(() => {});
  const printBtn = h('button.btn.sm', { type: 'button', onclick: () => window.print() }, 'طباعة أو حفظ PDF');
  const loginBtn = h('a.btn.sm.primary', { href: '/login' }, 'تسجيل الدخول');
  const tools = h('div.row');

  const draw = data => {
    tools.replaceChildren(...[
      login && !auth.session ? loginBtn : null,
      printBtn,
      auth.session && isManager() ? codeBtn(key) : null
    ].filter(Boolean));
    return page(data);
  };

  // العضو المفعّل يراها مباشرة، والزائر يُجرَّب له الرمز المحفوظ في هذه الجلسة
  try {
    const data = await db.rpc('open_page', { p_key: key, p_code: readCode(key) || null });
    return shell(draw(data), tools, wide);
  } catch (e) {
    if (!/REQUIRE_CODE|رمز الاطّلاع/.test(e.message)) return shell(h('p.err', e.message), tools, wide);
  }

  tools.replaceChildren(...[login && !auth.session ? loginBtn : null].filter(Boolean));
  const box = h('div');
  box.replaceChildren(gate(key, title, data => { box.replaceChildren(draw(data)); window.scrollTo(0, 0); }));
  return shell(box, tools, wide);
}

// /about — تعريف موجز بالمنصة، مفتوح
export const render = () => view({ key: 'about', title: 'عن المنصة' });

// /initiative — عرض المبادرة كاملًا، رابط مستقل بزر دخول وخط أكبر
export const initiative = () => view({ key: 'initiative', title: 'عن المبادرة', login: true, wide: true });
