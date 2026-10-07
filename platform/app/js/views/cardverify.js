// التحقّقُ من بطاقة العمل: صفحةٌ عامّةٌ بلا تسجيل دخول، يفتحها الباركودُ
// المطبوع على البطاقة. وتُثبتها ولا تُفشي صاحبَها: ما في وجه البطاقة لا
// غير — لا هويةَ ولا بريدَ ولا جوّالَ ولا حساب (ملاحظة ٣١٣).
import { h, fill, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { brand, footer } from './shell.js';

const TONE = { 'سارية': 'ok', 'منتهية': 'bad', 'موقوفة': 'bad', 'غير معتمدة': 'warn' };

export async function render(ctx) {
  const q = ctx?.query || new URLSearchParams(location.search);
  const noField = h('input', { value: q.get('no') || '', dir: 'ltr',
    placeholder: '1053', 'aria-label': 'رقم العضوية' });
  const keyField = h('input', { value: q.get('k') || '', dir: 'ltr',
    placeholder: 'مفتاحُ التحقق', 'aria-label': 'مفتاح التحقق' });
  const out = h('div.stack');

  const go = h('button.btn.primary', { type: 'button' }, 'تحقّق');
  go.onclick = () => check();

  const row = (k, v) => (v ? [h('dt', k), h('dd', v)] : null);

  async function check() {
    const no = noField.value.trim();
    const k = keyField.value.trim();
    if (!no || !k) {
      fill(out, h('p.muted', 'اكتب رقمَ العضوية ومفتاحَ التحقق، أو افتح الرابط من الباركود.'));
      return;
    }
    fill(out, h('p.muted', 'يُتحقَّق…'));
    let v = null;
    try { v = await db.rpc('verify_card', { p_no: no, p_key: k }); }
    catch (err) { fill(out, h('p.bad', err.message)); return; }
    v = Array.isArray(v) ? v[0] : v;

    if (!v || !v.full_name) {
      fill(out, h('div.card.stack',
        h('h3.bad', 'لا بطاقةَ بهذا الرقم'),
        h('p.small.muted', 'تأكّد من الرقم ومن مفتاح التحقق، أو افتح الرابط من '
          + 'الباركود المطبوع على البطاقة.')));
      return;
    }

    const tone = TONE[v.state] || 'warn';
    fill(out, h('div.card.stack', { class: tone === 'ok' ? 'verify-ok' : 'verify-bad' },
      h('div.row',
        h('span.pill', { class: tone }, v.state),
        h('span.small.muted', { dir: 'ltr' }, `No. ${v.member_no}`)),
      h('h3', v.full_name),
      h('dl.verify-grid',
        row('الصفة', v.role_text),
        row('الفريق', v.track),
        row('اللغات', v.langs),
        row('سارية حتى', v.valid_until ? fmtDate(v.valid_until) : null)),
      h('p.small.muted', 'بطاقةُ عملٍ صادرةٌ عن مشروع خادم الحرمين الشريفين لترجمة '
        + 'خطب الحرمين — الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي.'),
      h('p.small.muted', 'ولا تُعرَض في هذه الصفحة بياناتٌ خاصّةٌ بصاحب البطاقة: '
        + 'إنّما تُثبَت البطاقةُ لا غير.')));
  }

  const page = h('div',
    h('header.topbar', h('div.inner',
      brand('التحقق من بطاقات العمل', 'مشروع خادم الحرمين الشريفين للترجمة', '/'))),
    h('main#main.auth-wrap', { tabindex: '-1' },
      h('div.card.stack', { style: { maxWidth: '620px' } },
        h('h2', 'التحقّق من بطاقة عمل'),
        h('p.small.muted', 'اكتب رقمَ العضوية ومفتاحَ التحقق المطبوعين على البطاقة، '
          + 'أو افتح الرابط من الباركود مباشرةً.'),
        h('div.grid-2',
          h('label.field', 'رقم العضوية', noField),
          h('label.field', 'مفتاح التحقق', keyField)),
        h('div.row', go)),
      out),
    footer());

  if (q.get('no') && q.get('k')) check();
  return page;
}
