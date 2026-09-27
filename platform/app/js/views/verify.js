// التحقق من رقم التوثيق المطبوع على العمل — صفحة عامة يفتحها رمز QR (ملاحظة ١٣٤)
// لا تكشف محتوى العمل، وإنما تبيّن وصفه وتاريخ اعتماده ليُتحقق من النسخة المطبوعة.
import { h, busy, fmtDate, fmtSermonDate, emptyState } from '../ui.js';
import { db } from '../sb.js';
import { brand, themeToggle, footer } from './shell.js';

const clean = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');

export async function render(ctx) {
  const input = h('input', { value: ctx.query.get('doc') || '', dir: 'ltr', autocomplete: 'off',
    placeholder: 'H48-EN-120042', 'aria-label': 'رقم التوثيق' });
  const result = h('div.stack');
  const go = h('button.btn.primary', { type: 'submit' }, 'تحقّق');

  async function lookup() {
    const no = clean(input.value);
    if (!no) { result.replaceChildren(emptyState('اكتب رقم التوثيق', 'الرقم مطبوع على العمل، وتحته رمز التحقق.')); return; }
    history.replaceState(null, '', `/verify?doc=${encodeURIComponent(no)}`);
    try {
      const rows = await db.rpc('verify_doc', { p_no: no });
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (!r) {
        result.replaceChildren(h('div.card.stack',
          h('div.policy-state.unsigned', 'لا يوجد عمل معتمد بهذا الرقم'),
          h('p.small.muted', 'تأكّد من كتابة الرقم كما هو مطبوع، بحروفه وأرقامه وشَرطتيه.')));
        return;
      }
      const row = (k, v) => (v ? h('tr', h('td', { 'data-label': k }, h('b', k)), h('td', { 'data-label': k }, v)) : null);
      result.replaceChildren(h('div.card.stack',
        h('div.policy-state.signed', 'عملٌ معتمد وموثَّق في المنصة'),
        h('div.table-wrap', h('table.responsive', h('tbody',
          row('رقم التوثيق', h('span.doc-no', { dir: 'ltr' }, r.doc_no)),
          row('نوع العمل', r.kind_label),
          row('الجهة', r.scope_label),
          row('اللغة', r.language),
          row('العنوان', r.title),
          row('تاريخ المادة', r.work_date ? fmtSermonDate(r.work_date) : null),
          row('تاريخ التوثيق', r.documented_on ? fmtDate(r.documented_on) : null),
          row('النشر', r.is_published ? 'منشورة على الموقع العام' : 'غير منشورة')))),
        h('p.small.muted', 'هذه الصفحة تبيّن وصف العمل وتاريخ اعتماده فقط، ولا تعرض محتواه ولا بيانات العاملين عليه.')));
    } catch (err) {
      result.replaceChildren(h('div.card', h('p.err', err.message)));
    }
  }

  const form = h('form.stack', { novalidate: true, onsubmit: e => { e.preventDefault(); busy(go, lookup); } },
    h('label.field', 'رقم التوثيق', h('small', 'كما هو مطبوع على العمل، مثل H48-EN-120042'), input),
    h('div.row', go));

  if (input.value) lookup();
  else result.replaceChildren(emptyState('اكتب رقم التوثيق', 'الرقم مطبوع على العمل، وتحته رمز التحقق.'));

  return h('div',
    h('header.topbar', h('div.inner',
      brand('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين', 'ترجمات بلغات العالم', '/'),
      h('div.spacer'), themeToggle())),
    h('main#main.wrap.public', { tabindex: '-1' },
      h('section.hero',
        h('div.eyebrow', 'التوثيق'),
        h('h1', 'التحقق من رقم التوثيق'),
        h('p', 'كل عمل معتمد في المنصة يحمل رقم توثيق ثابتًا يُطبع عليه. اكتب الرقم هنا، أو امسح رمز التحقق المطبوع بجواره.')),
      h('div.card.stack', form),
      result),
    footer('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين',
      'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'));
}
