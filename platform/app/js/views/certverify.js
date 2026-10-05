// التحقّقُ من شهادة: صفحةٌ عامّةٌ بلا تسجيل دخول، يفتحها الباركود
// المطبوع عليها، فتتحقّق منها أيُّ جهةٍ خارجية. ولا يُعرَض من بيانات
// صاحبها سوى اسمه (ملاحظة ٢٦٧ ز و ي)
import { h, fill, fmtDate, fmtHijri } from '../ui.js';
import { db } from '../sb.js';
import { brand, footer } from './shell.js';

export async function render(ctx) {
  const q = ctx?.query || new URLSearchParams(location.search);
  const noField = h('input', { value: q.get('no') || '', dir: 'ltr',
    placeholder: 'HS-1448-0147', 'aria-label': 'رقم الشهادة' });
  const keyField = h('input', { value: q.get('k') || '', dir: 'ltr',
    placeholder: 'مفتاحُ التحقق', 'aria-label': 'مفتاح التحقق' });
  const out = h('div.stack');

  const go = h('button.btn.primary', { type: 'button' }, 'تحقّق');
  go.onclick = () => check();

  async function check() {
    const no = noField.value.trim();
    const k = keyField.value.trim();
    if (!no || !k) {
      fill(out, h('p.muted', 'اكتب رقمَ الشهادة ومفتاحَ التحقق، أو افتح الرابط من الباركود.'));
      return;
    }
    fill(out, h('p.muted', 'يُتحقَّق…'));
    let v = null;
    try { v = await db.rpc('verify_certificate', { p_no: no, p_key: k }); }
    catch (err) { fill(out, h('p.bad', err.message)); return; }
    v = Array.isArray(v) ? v[0] : v;

    if (!v || !v.found) {
      fill(out, h('div.card.stack',
        h('h3.bad', 'لا شهادةَ بهذا الرقم'),
        h('p.small.muted', 'تأكّد من الرقم ومن مفتاح التحقق، أو افتح الرابط من الباركود '
          + 'المطبوع على الشهادة.')));
      return;
    }

    const ok = v.state === 'صحيحة';
    fill(out, h('div.card.stack', { class: ok ? 'verify-ok' : 'verify-bad' },
      h('div.row',
        h('span.pill', { class: ok ? 'ok' : 'bad' }, v.state),
        h('span.small.muted', { dir: 'ltr' }, v.no)),
      h('h3', v.title),
      h('dl.verify-grid',
        row('صاحبُ الشهادة', v.name),
        row('النوع', v.kind),
        v.hours ? row('المدّة', `${v.hours} ساعة`) : null,
        v.start_on ? row('التاريخ',
          v.end_on ? `${fmtHijri(v.start_on)} – ${fmtHijri(v.end_on)}` : fmtHijri(v.start_on)) : null,
        v.issued_at ? row('تاريخُ الإصدار', fmtDate(v.issued_at)) : null),
      ok ? null : h('p.small', 'أُلغيت هذه الشهادة' + (v.revoke_why ? `: ${v.revoke_why}` : '.')),
      h('p.small.muted', 'صدرت عن مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين — '
        + 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي.')));
  }

  const row = (k, v) => [h('dt', k), h('dd', v)];

  const page = h('div',
    h('header.topbar', h('div.inner', brand('التحقق من الشهادات', 'مشروع خادم الحرمين الشريفين للترجمة', '/'))),
    h('main#main.auth-wrap', { tabindex: '-1' },
      h('div.card.stack', { style: { maxWidth: '620px' } },
        h('h2', 'التحقّق من شهادة'),
        h('p.small.muted', 'اكتب رقمَ الشهادة ومفتاحَ التحقق المطبوعين عليها، '
          + 'أو افتح الرابط من الباركود مباشرةً.'),
        h('div.grid-2',
          h('label.field', 'رقم الشهادة', noField),
          h('label.field', 'مفتاح التحقق', keyField)),
        h('div.row', go)),
      out),
    footer());

  if (q.get('no') && q.get('k')) check();
  return page;
}
