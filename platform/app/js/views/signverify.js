// التحقُّقُ من وثيقة إثبات التوقيع: صفحةٌ عامّةٌ بلا تسجيل دخول، يفتحها
// الباركودُ المطبوع عليها وقد تحقَّقت — فلا يُكتَب فيها رقمٌ ولا يُطلَب
// حساب (ملاحظة ٤٢٨)
//
//   ولا يُعرَض من السجلِّ إلا ما تُقام به الحجّة: الاسمُ ورقمُ العضوية،
//   ونسخةُ الميثاق ووقتُ التوقيع، والاسمُ الذي وقَّع به، وبصمةُ النصِّ.
//   أمّا عنوانُ الشبكة ووصفُ الجهاز فللإدارة في المنصة وحدَها.
import { h, fill, fmtDate, fmtDateTime, fmtHijri } from '../ui.js';
import { db } from '../sb.js';
import { brand, footer } from './shell.js';
import { policyOf, policyBreachClause } from '../policy.js';

export async function render(ctx) {
  const q = ctx?.query || new URLSearchParams(location.search);
  const codeField = h('input', { value: q.get('c') || '', dir: 'ltr',
    placeholder: 'SG-XXXXXXXXXX', 'aria-label': 'رمز وثيقة الإثبات', maxlength: 20 });
  const out = h('div.stack');

  const go = h('button.btn.primary', { type: 'button' }, 'تحقّق');
  go.onclick = () => check();

  const row = (k, v, ltr) => [h('dt', k),
    h('dd', ltr ? { dir: 'ltr', class: 'mono' } : {}, v)];

  async function check() {
    const code = codeField.value.trim().toUpperCase();
    if (code.length < 8) {
      fill(out, h('p.muted', 'امسحِ الباركودَ المطبوع على الوثيقة، أو اكتبْ رمزَها كاملًا.'));
      return;
    }
    fill(out, h('p.muted', 'يُتحقَّق…'));
    let v = null;
    try { v = await db.rpc('verify_signature', { p_code: code }); }
    catch (err) { fill(out, h('p.bad', err.message)); return; }
    v = Array.isArray(v) ? v[0] : v;

    if (!v || !v.found) {
      fill(out, h('div.card.stack.verify-bad',
        h('h3.bad', 'لا وثيقةَ بهذا الرمز'),
        h('p.small.muted', 'تأكّدْ من الرمز كما هو مطبوعٌ على الوثيقة، '
          + 'أو امسحِ الباركودَ منها مباشرةً.')));
      return;
    }

    const p = policyOf(v.version);
    fill(out, h('div.card.stack.verify-ok',
      h('div.row',
        h('span.pill.ok', 'توقيعٌ صحيح'),
        h('span.small.muted', { dir: 'ltr' }, v.code)),
      h('h3', `${p.title} — النسخة ${v.version}`),
      h('dl.verify-grid',
        row('اسمُ العضو', v.name),
        v.member_no != null ? row('رقمُ العضوية', String(v.member_no)) : null,
        row('الاسمُ الذي وقَّع به', v.signed_name),
        row('وقتُ التوقيع', fmtDateTime(v.accepted_at)),
        row('تاريخُه الهجري', fmtHijri(String(v.accepted_at).slice(0, 10))),
        v.state ? row('حالُ العضو', v.state) : null,
        v.doc_hash ? row('بصمةُ النصِّ الموقَّع', v.doc_hash, true) : null),
      h('div.policy-clause',
        h('b.small', `بندُ المخالفة في النسخة ${v.version} — بنصِّه`),
        h('p', policyBreachClause(v.version))),
      v.doc_hash
        ? h('p.small.muted', 'بصمةُ النصِّ محسوبةٌ على نصِّ الميثاق الذي عُرِض على العضو '
            + 'حرفًا بحرف وقتَ توقيعه، وهي بصمةُ النصِّ المطبوع في وثيقته.')
        : h('p.small.muted', 'هذا التوقيعُ سابقٌ لاستحداث بصمة النصِّ، '
            + 'والمحتجُّ به نصُّ نسخته المحفوظُ في المنصة والمطبوعُ في وثيقته.'),
      h('p.small.muted', 'صدر هذا الإثباتُ عن مشروع خادم الحرمين الشريفين لترجمة خطب '
        + 'الحرمين — الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي.')));
  }

  const page = h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/'))),
    h('main#main.auth-wrap', { tabindex: '-1' },
      h('div.card.auth-card.stack', { style: { maxWidth: '760px' } },
        h('div', h('div.eyebrow', 'تحقُّق'), h('h2', 'وثيقةُ إثبات التوقيع'),
          h('p.small.muted', 'كلُّ وثيقةِ إثباتٍ تحمل رمزًا وباركودًا. '
            + 'امسحِ الباركودَ لتُفتَح هذه الصفحةُ وقد تحقَّقت، أو اكتبِ الرمزَ هنا.')),
        h('div.row.wrap', h('label.field.grow', 'رمزُ الوثيقة', codeField), go),
        out,
        h('p.small.muted', `${fmtDate(new Date())}`))),
    footer());

  if (q.get('c')) setTimeout(check, 0);
  return page;
}

export default render;
