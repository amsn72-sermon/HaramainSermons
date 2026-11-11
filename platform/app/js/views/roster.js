// صفحةُ كشف التواقيع: يفتحها باركودُ رأس الكشف المطبوع (ملاحظة ٤٩٨)
//
//   في كلِّ صفٍّ من الكشف باركودُ صاحبه يفتح وثيقةَ إثباته وحدَه، وفي
//   رأس الكشف باركودٌ واحدٌ يفتح الكشفَ كما طُبع: نصُّ الميثاق ونطاقُه،
//   ومن وقَّع ومن لم يوقِّع يومَها. وهذا كشفٌ داخليٌّ فيه أرقامُ الهويات،
//   فلا يُفتَح إلّا لإداريٍّ في المنصة يملك مفتاحَ «كشوف التواقيع»،
//   ويُسجَّل كلُّ فتحٍ — المأذونُ والممنوع — بصاحبه ووقته وعنوانه.
import { h, fill, fmtDate, fmtDateTime, toast } from '../ui.js';
import { db } from '../sb.js';
import { isManager } from '../store.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const CITY = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };

export async function render(ctx) {
  const q = ctx?.query || new URLSearchParams(location.search);
  const codeField = h('input', { value: q.get('c') || '', dir: 'ltr',
    placeholder: 'RS-XXXXXXXXXX', 'aria-label': 'رمز الكشف', maxlength: 20 });
  const out = h('div.stack');

  const go = h('button.btn.primary', { type: 'button' }, 'افتحِ الكشف');
  go.onclick = () => open();

  async function open() {
    const code = codeField.value.trim().toUpperCase();
    if (code.length < 8) {
      fill(out, h('p.muted', 'امسحْ باركودَ رأس الكشف، أو اكتبْ رمزَه كاملًا.'));
      return;
    }
    fill(out, h('p.muted', 'يُفتَح…'));
    let v = null;
    try { v = await db.rpc('roster_proof', { p_code: code }); }
    catch (err) { fill(out, h('p.bad', err.message)); return; }
    v = Array.isArray(v) ? v[0] : v;

    if (!v || !v.found) {
      fill(out, v && v.denied
        ? h('div.card.stack',
            h('p.bad', 'هذا كشفٌ داخليٌّ لا يُفتَح إلّا لمن يملك مفتاحَ كشوف '
              + 'التواقيع في المنصة.'),
            h('p.small.muted', 'وقد سُجِّلت محاولتُك باسمك ووقتها وعنوانها، '
              + 'كما يُسجَّل كلُّ فتحٍ مأذونٍ فيه.'))
        : h('p.bad', 'لا كشفَ بهذا الرمز. تأكَّدْ من مسح الباركود كاملًا.'));
      return;
    }

    const rows = Array.isArray(v.rows) ? v.rows : [];
    const stateOf = r => (r.signed ? h('span.badge.ok', 'وقَّع')
      : r.prev ? h('span.badge.warn', `وقَّع النسخة ${r.version || '—'}`)
        : h('span.badge.bad', 'لم يوقِّعْ'));

    fill(out,
      h('div.card.stack',
        h('h2', v.title || 'كشفُ التوقيع على الميثاق'),
        h('p.small.muted',
          [v.band, v.city ? (CITY[v.city] || v.city) : '', `النسخة ${v.version}`]
            .filter(Boolean).join(' — ')),
        h('p.small.muted', `طُبع في ${fmtDateTime(v.created_at)}`
          + (v.created_by ? ` بيد ${v.created_by}` : '')
          + ` — ${AR(v.n_rows)} عضوًا، وقَّع منهم ${AR(v.n_signed)}.`),
        v.note ? h('p.small.muted', v.note) : null),

      h('div.card.stack',
        h('h3', `أهلُ الكشف (${AR(rows.length)})`),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['م', 'العضو', 'رقمُ الهوية', 'الفريق', 'المدينة',
            'الحال', 'تاريخُ التوقيع', 'رمزُ الوثيقة'].map(t => h('th', t)))),
          h('tbody', rows.map((r, i) => h('tr',
            h('td', { 'data-label': 'م' }, AR(i + 1)),
            h('td', { 'data-label': 'العضو' }, h('b', r.name || '—'),
              r.member_no ? h('div.small.muted', String(r.member_no)) : null),
            h('td', { 'data-label': 'رقمُ الهوية', dir: 'ltr' }, r.national_id || '—'),
            h('td', { 'data-label': 'الفريق' }, r.track || '—'),
            h('td', { 'data-label': 'المدينة' }, r.city ? (CITY[r.city] || r.city) : '—'),
            h('td', { 'data-label': 'الحال' }, stateOf(r)),
            h('td', { 'data-label': 'التاريخ' },
              r.accepted_at ? fmtDateTime(r.accepted_at) : '—'),
            h('td', { 'data-label': 'الرمز', dir: 'ltr', class: 'mono' },
              r.proof_code || '—')))))) ),

      v.doc_text ? h('details.cd-more',
        h('summary', `نصُّ الميثاق الذي وُقِّع عليه — النسخة ${v.version}`),
        h('div.card', h('pre.policy-text', v.doc_text))) : null,

      isManager() ? logBox(code) : null);
  }

  // سجلُّ من فتح هذا الكشف: لمدير المشروع، فالرقابةُ على البابِ أيضًا
  function logBox(code) {
    const box = h('div.stack');
    const btn = h('button.btn.sm', { type: 'button' }, 'سجلُّ من فتح هذا الكشف');
    btn.onclick = async () => {
      try {
        const list = await db.rpc('roster_log', { p_code: code });
        const rows = Array.isArray(list) ? list : [];
        fill(box, rows.length
          ? h('div.table-wrap', h('table.responsive',
              h('thead', h('tr', ['الوقت', 'من فتحه', 'الحال', 'العنوان']
                .map(t => h('th', t)))),
              h('tbody', rows.map(r => h('tr',
                h('td', { 'data-label': 'الوقت' }, fmtDateTime(r.at)),
                h('td', { 'data-label': 'من' }, r.member || '—'),
                h('td', { 'data-label': 'الحال' }, r.ok
                  ? h('span.badge.ok', 'فُتح له') : h('span.badge.bad', 'مُنع')),
                h('td', { 'data-label': 'العنوان', dir: 'ltr', class: 'mono' },
                  r.ip || '—'))))))
          : h('p.small.muted', 'لا فتحَ مسجَّلٌ بعد.'));
      } catch (err) { toast(err.message, 'bad'); }
    };
    return h('div.card.stack', h('h3', 'سجلُّ الفتح'),
      h('p.small.muted', 'كلُّ مسحٍ لباركود الرأس مسجَّلٌ بصاحبه ووقته وعنوانه، '
        + 'المأذونُ فيه والممنوع.'), btn, box);
  }

  if (codeField.value.trim()) setTimeout(open, 0);

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'كشوفُ التواقيع'),
      h('h1', 'فتحُ كشفٍ بباركود رأسه'),
      h('p.muted', `كشفٌ داخليٌّ لا يُنشر — ${fmtDate(new Date())}`))),
    h('div.card.stack',
      h('label.field', 'رمزُ الكشف', codeField),
      h('div.row', go)),
    out);
}
