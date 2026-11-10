// التحقق من رقم التوثيق المطبوع على العمل — صفحة عامة يفتحها رمز QR (ملاحظة ١٣٤)
//
//   وتُظهر بيانَ العمل مختصرًا، ثم الخطبةَ نفسَها على كليشة الهيئة إن
//   كانت منشورةً (ملاحظة ٤٩١): فمن مسح الباركودَ من الورقة قرأ الخطبةَ
//   من موضعها الموثَّق لا من نقلٍ عنها، وطبعها أو حفظها PDF كما هي.
//   وغيرُ المنشورة يُعرَض وصفُها ويُقال إنها لم تُنشر بعدُ، فالنشرُ
//   قرارٌ لا يتجاوزه باركود.
import { h, toast, busy, fmtDate, fmtSermonDate, emptyState } from '../ui.js';
import { db } from '../sb.js';
import { brand, themeToggle, footer } from './shell.js';

const clean = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');

export async function render(ctx) {
  const input = h('input', { value: ctx.query.get('doc') || '', dir: 'ltr', autocomplete: 'off',
    placeholder: 'H48-EN-120042', 'aria-label': 'رقم التوثيق' });
  const result = h('div.stack');
  // وحدةُ التصدير تُحمَّل سلفًا، فيقع `window.open` في مُعالِج النقرة
  //   نفسِه ولا يحجبه المتصفِّح (ملاحظة ٤٩١)
  let exportMod = null;
  const preloadExport = () => (exportMod ||= import('../export.js'));
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

      // ـــ فتحُ الخطبة على كليشة الهيئة: صفحاتُها كما تُطبَع، تُحفَظ
      //   PDF من نافذة الطباعة نفسِها
      if (r.body_html) preloadExport();
      const openDoc = h('button.btn.primary', { type: 'button' }, '📄 افتحِ الخطبةَ كاملةً');
      openDoc.onclick = () => busy(openDoc, async () => {
        try {
          const { printTranslation } = await preloadExport();
          const ok = printTranslation({
            material: { title: r.title, mosque: r.mosque, sermon_date: r.work_date,
              material_type: r.material_type, sermon_type: r.sermon_type,
              khateeb: r.khateeb ? { name: r.khateeb } : null },
            // ومعه تاريخُ التوثيق، وإلّا خرج ختمُ الوثيقة بلا تاريخ
            track: { language_code: r.language_code, translation_html: r.body_html,
              doc_no: r.doc_no, doc_no_at: r.documented_on, title_tr: null },
            khateeb: r.khateeb || null
          }, { autoPrint: false });
          if (!ok) toast('اسمحْ بالنوافذ المنبثقة لتُفتح الخطبة.', 'bad');
        } catch (e) { toast(e.message, 'bad'); }
      });

      result.replaceChildren(h('div.card.stack',
        h('div.policy-state.signed', 'عملٌ معتمد وموثَّق في المنصة'),
        // بيانٌ مختصرٌ لا يُطيل: ما يُقابَل به المطبوع (ملاحظة ٤٩١)
        h('div.table-wrap', h('table.responsive', h('tbody',
          row('رقم التوثيق', h('span.doc-no', { dir: 'ltr' }, r.doc_no)),
          row('العنوان', r.title),
          row('الخطيب', r.khateeb),
          row('الجهة', r.scope_label),
          row('اللغة', r.language),
          row('تاريخ الخطبة', r.work_date ? fmtSermonDate(r.work_date) : null),
          row('تاريخ التوثيق', r.documented_on ? fmtDate(r.documented_on) : null)))),
        r.body_html
          ? h('div.stack',
              h('div.row', openDoc),
              h('p.small.muted', 'تُفتح الخطبةُ على كليشة الهيئة بصفحاتها كما تُطبَع، '
                + 'فتقرؤها أو تحفظها PDF من نافذة الطباعة.'))
          : h('div.stack',
              h('p.small.warn', r.is_published
                ? 'لا نصَّ محفوظًا لهذه الترجمة.'
                : 'هذه الترجمةُ موثَّقةٌ ولم تُنشر بعد، فلا يُعرَض نصُّها هنا.'),
              h('p.small.muted', 'ورقمُ التوثيق أعلاه يُثبت اعتمادَها في المنصة.'))));
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
        h('p', 'كل عمل معتمد في المنصة يحمل رقم توثيق ثابتًا يُطبع عليه. اكتب الرقم هنا، '
          + 'أو امسح رمز التحقق المطبوع بجواره — وتُفتح الخطبةُ المنشورةُ كاملةً من هنا.')),
      h('div.card.stack', form),
      result),
    footer('مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين',
      'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'));
}
