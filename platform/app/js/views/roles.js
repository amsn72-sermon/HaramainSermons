// تسمياتُ الأدوار: الاسمُ الظاهرُ لكلِّ دورٍ يكتبه مديرُ المشروع،
// فيتغيّر في المنصة كلِّها دفعةً واحدة. والاسمُ وحدَه هو الذي يتغيّر لا
// الصلاحيات: فالدورُ ثابتٌ بمفتاحه، وما يُكتب وجهُه للناس (ملاحظة ٢٧٢)
import { h, fill, toast, busy } from '../ui.js';
import { db } from '../sb.js';
import { isManager, loadRoleLabels } from '../store.js';

export async function render() {
  if (!isManager()) return h('p.muted', 'هذه الشاشة لمدير المشروع.');

  const list = h('div.stack');
  const page = h('div',
    h('div.page-head', h('div', h('p.eyebrow', 'الإعدادات'), h('h2', 'تسمياتُ الأدوار'))),
    h('p.lead', 'لكلِّ دورٍ اسمٌ يظهر به في القائمة وفي بطاقات الأعضاء وفي التقارير '
      + 'وفي التصدير. اكتب ما شئت، فيتغيّر في المنصة كلِّها دفعةً واحدة.'),
    h('p.small.muted', 'يتغيّر الاسمُ وحدَه لا الصلاحيات. والتقاريرُ تخرج بالاسم القائم يومَ إخراجها.'),
    h('div.card.stack', list));

  async function draw() {
    let rows = [];
    try {
      rows = await db.select('role_labels', { select: '*', order: 'sort.asc' }) || [];
    } catch (err) { fill(list, h('p.muted', err.message)); return; }

    fill(list, rows.map(r => {
      const name  = h('input', { value: r.label || '', 'aria-label': `اسم ${r.base_label}` });
      const descr = h('textarea', { rows: 2, 'aria-label': `وصف ${r.base_label}` }, r.descr || '');
      const save = h('button.btn.sm.primary', { type: 'button' }, 'حفظ');
      save.onclick = () => busy(save, async () => {
        try {
          await db.rpc('set_role_label', { p_key: r.key, p_label: name.value.trim(),
            p_descr: descr.value.trim() || null });
          await loadRoleLabels();
          toast('حُفظ الاسم.', 'ok'); draw();
        } catch (err) { toast(err.message, 'bad'); }
      });
      const reset = h('button.btn.sm.ghost', { type: 'button', title: 'العودة إلى الاسم الأصلي' }, '↺ الأصل');
      reset.onclick = () => busy(reset, async () => {
        try {
          await db.rpc('reset_role_label', { p_key: r.key });
          await loadRoleLabels();
          toast('أُعيد الاسمُ الأصلي.', 'ok'); draw();
        } catch (err) { toast(err.message, 'bad'); }
      });

      return h('div.role-row',
        h('div.role-base', h('small.muted', 'الأصل'), h('b', r.base_label)),
        h('label.field', 'الاسم الظاهر', name),
        h('label.field', 'الوصف', descr,
          h('small', 'يظهر في صفحة «عن المبادرة» إن كان لهذا الدور بطاقةٌ فيها')),
        h('div.row', save, reset));
    }));
  }

  draw();
  return page;
}
