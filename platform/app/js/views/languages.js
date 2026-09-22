// اللغات: مرجع واحد تستخدمه المنصة والموقع العام
import { h, toast, busy, dialog } from '../ui.js';
import { db } from '../sb.js';
import { state, loadReference } from '../store.js';

export async function render(ctx) {
  await loadReference(true);
  const counts = await db.select('member_languages', { select: 'language_code' });
  const n = code => counts.filter(c => c.language_code === code).length;
  const reload = async () => { await loadReference(true); ctx.navigate('/app/languages', { replace: true }); };

  async function add() {
    const code = h('input', { dir: 'ltr', placeholder: 'مثال: sw', maxlength: 8 });
    const name = h('input', { placeholder: 'مثال: السواحلية' });
    const native = h('input', { dir: 'auto', placeholder: 'مثال: Kiswahili' });
    const dir = h('select', h('option', { value: 'ltr' }, 'من اليسار إلى اليمين'), h('option', { value: 'rtl' }, 'من اليمين إلى اليسار'));
    const err = h('p.err', { hidden: true });
    const v = await dialog({ title: 'إضافة لغة', body: h('div.stack',
      h('label.field', 'الرمز', h('small', 'رمز ISO 639 بأحرف لاتينية صغيرة'), code), h('label.field', 'الاسم بالعربية', name),
      h('label.field', 'الاسم بلغته', native), h('label.field', 'اتجاه الكتابة', dir), err),
      buttons: [{ label: 'إضافة', kind: 'primary', validate: () => {
        const e = !/^[a-z]{2,8}$/.test(code.value.trim()) ? 'الرمز أحرف لاتينية صغيرة (٢–٨)' : name.value.trim().length < 2 ? 'اكتب الاسم بالعربية' : !native.value.trim() ? 'اكتب الاسم بلغته' : '';
        err.textContent = e; err.hidden = !e; return !e;
      }, value: () => ({ code: code.value.trim(), name_ar: name.value.trim(), native_name: native.value.trim(), dir: dir.value, sort: 100 }) }, { label: 'إلغاء', value: null }] });
    if (!v) return;
    try { await db.insert('languages', v); toast('أُضيفت اللغة. اربط بها مترجمًا من «فريق العمل».', 'ok'); reload(); }
    catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'الرمز أو الاسم مستخدم مسبقًا' : e.message, 'bad'); }
  }

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'اللغات'),
      h('p.muted', 'التعطيل يخفي اللغة من التكليفات الجديدة ويحفظ الأعمال السابقة. اللغات الرئيسية ثابتة.')),
      h('button.btn.primary', { onclick: add }, '＋ إضافة لغة')),
    h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['اللغة', 'بلغتها', 'الاتجاه', 'الأعضاء المؤهلون', 'الحالة'].map(t => h('th', t)))),
      h('tbody', state.languages.map(l => h('tr',
        h('td', { 'data-label': 'اللغة' }, h('b', l.name_ar), h('span.sub', { dir: 'ltr' }, l.code)),
        h('td', { 'data-label': 'بلغتها', dir: l.dir }, l.native_name),
        h('td', { 'data-label': 'الاتجاه' }, l.dir === 'rtl' ? 'يمين ← يسار' : 'يسار → يمين'),
        h('td', { 'data-label': 'المؤهلون' }, n(l.code) || h('span.badge.warn', 'لا أحد')),
        h('td', { 'data-label': 'الحالة' }, l.is_core ? h('span.badge.gold', 'رئيسية ثابتة')
          : h('button.btn.sm', { class: l.is_active ? '' : 'primary', onclick: e => busy(e.currentTarget, async () => {
            try { await db.update('languages', { code: `eq.${l.code}` }, { is_active: !l.is_active }); reload(); } catch (err) { toast(err.message, 'bad'); }
          }) }, l.is_active ? 'مفعّلة · تعطيل' : 'معطّلة · تفعيل'))))))));
}
