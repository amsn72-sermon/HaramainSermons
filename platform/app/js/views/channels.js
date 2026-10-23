// قنواتُ مزامنة البثّ (ملاحظة ٤٦٧)
//
//   خطبةُ الجمعة تُبثُّ على أكثر من قناةٍ لقيود يوتيوب في عدد البثوث
//   المتزامنة، ثمَّ كانت تُجمَع في الرئيسية بيد المسؤول — فإن نسي لم
//   يُعرَض إلا ما كان عليها. والمزامنةُ اليومَ تقرأ القنواتِ المسجَّلةَ
//   هنا كلَّها وتدمج خطبَها، فلا يتعلّق البثُّ بذاكرة أحد.
import { h, fill, toast, busy, dialog, confirm, fmtDateTime, emptyState } from '../ui.js';
import { db } from '../sb.js';
import { isManager } from '../store.js';

const ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

// يُقبَل معرّفُ القناة، أو رابطُها إن حمل المعرّف
const idFrom = v => {
  const s = String(v || '').trim();
  const m = s.match(/UC[A-Za-z0-9_-]{22}/);
  return m ? m[0] : '';
};

export async function render(ctx) {
  const may = isManager();
  let rows = [];
  try { rows = await db.rpc('sync_channels_all') || []; } catch (e) { toast(e.message, 'bad'); }

  const box = h('div.stack');
  const reload = () => ctx.navigate('/app/channels', { replace: true });

  async function edit(row) {
    const name = h('input', { value: row?.name || '', maxlength: 60,
      'aria-label': 'اسم القناة', placeholder: 'القناة الثانية' });
    const id = h('input', { dir: 'ltr', value: row?.channel_id || '',
      'aria-label': 'معرّف القناة', placeholder: 'UC… أو رابط القناة' });
    const src = h('input', { dir: 'ltr', value: row?.source || '',
      'aria-label': 'رابط القناة', placeholder: 'https://www.youtube.com/@…' });
    const sort = h('input', { type: 'number', min: '1', max: '999',
      value: String(row?.sort ?? ((rows[rows.length - 1]?.sort || 0) + 10)),
      'aria-label': 'ترتيب الترجيح' });
    const on = h('input', { type: 'checkbox', checked: (row ? row.is_active : true) ? true : null,
      'aria-label': 'تُقرَأ في المزامنة' });
    const note = h('input', { value: row?.note || '', maxlength: 120, 'aria-label': 'بيان' });
    const err = h('p.err', { hidden: true });

    const res = await dialog({
      title: row ? `قناة: ${row.name}` : 'إضافةُ قناة',
      body: h('div.stack',
        h('p.small.muted', 'المعرّفُ هو الفيصل، ويُنسَخ من يوتيوب: القناة ← '
          + '«مزيد من المعلومات حول هذه القناة» ← مشاركة القناة ← نسخ معرّف القناة. '
          + 'وتستطيع لصقَ رابط القناة فيُستخرَج منه المعرّفُ إن كان فيه.'),
        h('label.field', 'اسمُ القناة', name),
        h('label.field', 'معرّفُها', id),
        h('label.field', 'رابطُها (اختياري)', src),
        h('label.field', 'ترتيبُ الترجيح',
          h('small', 'الأصغرُ أعلى: إذا بُثَّت لغةٌ على قناتين أُخذ مقطعُ الأعلى '
            + 'ترتيبًا، وحُفظ الآخرُ بديلًا'), sort),
        h('label.check', on, h('span', 'تُقرَأ في المزامنة')),
        h('label.field', 'بيانٌ (اختياري)', note),
        err),
      buttons: [
        { label: row ? 'حفظ' : 'أضِفْها', kind: 'primary',
          validate: () => {
            const cid = idFrom(id.value);
            const e = name.value.trim().length < 2 ? 'اكتبْ اسمَ القناة'
              : !ID_RE.test(cid) ? 'المعرّفُ يبدأ بـ UC ويتبعه اثنان وعشرون حرفًا' : '';
            err.textContent = e; err.hidden = !e;
            return !e;
          },
          value: () => ({ id: idFrom(id.value), name: name.value.trim(),
            src: src.value.trim() || null, sort: Number(sort.value) || 100,
            on: !!on.checked, note: note.value.trim() || null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('set_sync_channel', { p_channel: res.id, p_name: res.name,
        p_source: res.src, p_sort: res.sort, p_active: res.on, p_note: res.note });
      toast(row ? 'حُفظت القناة.' : 'أُضيفت القناة.', 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function remove(row) {
    if (!await confirm('حذفُ قناة',
      `تُحذَف «${row.name}» فلا تُقرأ منها خطبةٌ بعد اليوم. وما عُرض منها قبلُ باقٍ.`,
      'احذفْها', 'danger')) return;
    try {
      await db.rpc('delete_sync_channel', { p_channel: row.channel_id });
      toast('حُذفت القناة.', 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  function card(r, i) {
    const acts = may ? h('div.row', { style: { gap: '6px' } },
      h('button.btn.sm', { type: 'button', onclick: () => edit(r) }, 'تعديل'),
      h('button.btn.sm.ghost', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
        try {
          await db.rpc('set_sync_channel', { p_channel: r.channel_id, p_name: r.name,
            p_source: r.source, p_sort: r.sort, p_active: !r.is_active, p_note: r.note });
          reload();
        } catch (e2) { toast(e2.message, 'bad'); }
      }) }, r.is_active ? 'تعطيل' : 'تفعيل'),
      h('button.btn.sm.danger', { type: 'button', onclick: () => remove(r) }, 'حذف')) : null;
    return h('div.card.row.between.wrap.tpl-row',
      h('div.stack', { style: { gap: '2px' } },
        h('b', `${i + 1}. ${r.name}`,
          i === 0 && r.is_active ? h('span.badge.ok', 'أعلى ترجيحًا') : null,
          r.is_active ? null : h('span.badge.warn', 'معطَّلة')),
        h('span.small.muted', { dir: 'ltr' }, r.channel_id),
        r.source ? h('a.small', { href: r.source, target: '_blank', rel: 'noopener', dir: 'ltr' },
          r.source) : null,
        r.note ? h('span.small.muted', r.note) : null,
        r.updated_at ? h('span.small.muted', `آخرُ تعديل: ${fmtDateTime(r.updated_at)}`) : null),
      acts);
  }

  fill(box, rows.length
    ? h('div.stack', rows.map(card))
    : emptyState('لا قنواتٍ مسجَّلة', 'أضِفْ قناةً ليُقرأ منها البثّ.'));

  return h('div',
    h('div.page-head',
      may ? h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        h('button.btn.sm.primary', { type: 'button', onclick: () => edit(null) },
          '＋ إضافةُ قناة')) : null,
      h('div.grow', h('div.eyebrow', 'الإعدادات'), h('h1', 'قنواتُ البثّ'),
        h('p.muted', 'القنواتُ التي تُقرأ منها خطبُ الحرمين وترجماتُها. '
          + 'تُدمَج خطبُها بعنوان قائمتها، ويُؤخَذ لكلِّ لغةٍ مقطعٌ واحدٌ بترتيب '
          + 'الترجيح أدناه، فلا تتكرّر لغةٌ ولو بُثَّت على قناتين.'))),
    box,
    h('p.small.muted', { style: { marginTop: '12px' } },
      'تقرأ المزامنةُ هذه القائمةَ كلَّ ربع ساعة. وإن تعذّر الوصولُ إلى المنصة '
      + 'عملت بالقنوات الثلاث المحفورة في أصلها، فلا ينقطع البثّ.'));
}

export default render;
