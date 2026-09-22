// إعداد سير العمل: قالب المراحل (يعدّله المدير، ويطّلع عليه المنسق)
import { h, toast, busy, dialog } from '../ui.js';
import { db } from '../sb.js';
import { state, isManager, loadReference, ROLE_LABEL } from '../store.js';

export async function render(ctx) {
  await loadReference(true);
  const canEdit = isManager();
  const reload = async () => { await loadReference(true); ctx.navigate('/app/workflow', { replace: true }); };

  async function addStage() {
    const name = h('input', { placeholder: 'مثال: المراجعة الفنية' });
    const after = h('select', state.stages.filter(s => !s.outside_sla).map(s => h('option', { value: s.sort }, `بعد ${s.name_ar}`)));
    const role = h('select', h('option', { value: 'translator' }, 'عضو مؤهل في اللغة'), h('option', { value: 'coordinator' }, 'منسق'));
    const weight = h('input', { type: 'number', min: 0, value: 1, step: 0.5 });
    const err = h('p.err', { hidden: true }, 'اكتب اسم المرحلة');
    const v = await dialog({ title: 'إضافة مرحلة', body: h('div.stack', h('label.field', 'اسم المرحلة', name), h('label.field', 'موضعها', after),
      h('label.field', 'تُسند إلى', role), h('label.field', 'نصيبها من المدة', h('small', 'وزن نسبي؛ الترجمة ٦ والمراجعات ٢'), weight), err),
      buttons: [{ label: 'إضافة', kind: 'primary', validate: () => { const ok = name.value.trim().length > 2; err.hidden = ok; return ok; },
        value: () => ({ name_ar: name.value.trim(), sort: Number(after.value) + 1, assignee_role: role.value, weight: Number(weight.value) || 0 }) },
        { label: 'إلغاء', value: null }] });
    if (!v) return;
    const key = 'stage_' + Date.now().toString(36);
    try { await db.insert('workflow_stages', { key, ...v }); toast('أُضيفت المرحلة. تسري على المواد الجديدة فقط.', 'ok'); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  }

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', canEdit ? 'إعداد سير العمل' : 'سير العمل'),
      h('p.muted', 'هذا قالب المسار الكامل. عند الإسناد تُحدَّد المراحل لكل لغة؛ الترجمة واستلام المنسق أساسيتان. التغييرات تسري على المواد الجديدة فقط.')),
      canEdit && h('button.btn.primary', { onclick: addStage }, '＋ إضافة مرحلة')),
    h('div.stack', state.stages.map((s, i) => h('div.card', h('div.row',
      h('span.badge.gold', String(i + 1)),
      h('div', { style: { flex: 1 } }, h('b', { class: s.is_active ? '' : 'muted' }, s.name_ar),
        h('div.small.muted', [`تُسند إلى: ${s.assignee_role === 'translator' ? 'عضو مؤهل في اللغة' : ROLE_LABEL[s.assignee_role]}`,
          s.outside_sla ? 'خارج وقت التنفيذ' : `الوزن الزمني ${s.weight}`].join(' · '))),
      s.is_required ? h('span.badge', 'أساسية') : s.outside_sla ? h('span.badge', 'اختيارية لكل لغة') : null,
      canEdit && !s.is_required && h('button.btn.sm', { onclick: e => busy(e.currentTarget, async () => {
        try { await db.update('workflow_stages', { key: `eq.${s.key}` }, { is_active: !s.is_active }); reload(); } catch (err) { toast(err.message, 'bad'); }
      }) }, s.is_active ? 'إيقاف' : 'تفعيل'))))));
}
