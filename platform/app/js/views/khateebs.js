// دليل الخطباء
import { h, toast, busy, dialog } from '../ui.js';
import { db } from '../sb.js';
import { state, loadReference, MOSQUE, CITY } from '../store.js';

export async function render(ctx) {
  await loadReference(true);
  const reload = async () => { await loadReference(true); ctx.navigate('/app/khateebs', { replace: true }); };

  async function add(mosque) {
    const name = h('input', { placeholder: 'فضيلة الشيخ الدكتور …' });
    const err = h('p.err', { hidden: true }, 'اكتب اسم الخطيب');
    const v = await dialog({ title: `إضافة خطيب — ${MOSQUE[mosque]}`, body: h('div.stack', h('label.field', 'الاسم كما يظهر في المواد', name), err),
      onOpen: () => name.focus(),
      buttons: [{ label: 'إضافة', kind: 'primary', validate: () => { const ok = name.value.trim().length > 3; err.hidden = ok; return ok; },
        value: () => name.value.trim() }, { label: 'إلغاء', value: null }] });
    if (!v) return;
    try { await db.insert('khateebs', { name: v, mosque, sort: 100 }); toast('أُضيف الخطيب.', 'ok'); reload(); }
    catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'الاسم موجود مسبقًا' : e.message, 'bad'); }
  }

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'دليل الخطباء'),
      h('p.muted', 'قائمة الخطباء التي تظهر عند إضافة خطبة. الإخفاء يحفظ الخطب السابقة كما هي.'))),
    h('div.grid-2', Object.keys(MOSQUE).map(mosque => {
      const list = state.khateebs.filter(k => k.mosque === mosque);
      return h('div.card', h('div.row', h('h3', { style: { flex: 1 } }, `${MOSQUE[mosque]} — ${CITY[mosque]}`), h('span.badge', `${list.filter(k => k.is_active).length} خطيبًا`)),
        h('ul', { style: { paddingInlineStart: '18px' } }, list.map(k => h('li', { style: { marginBottom: '6px' } },
          h('span', { class: k.is_active ? '' : 'muted', style: { textDecoration: k.is_active ? 'none' : 'line-through' } }, k.name), ' ',
          h('button.btn.sm.ghost', { onclick: e => busy(e.currentTarget, async () => {
            try { await db.update('khateebs', { id: `eq.${k.id}` }, { is_active: !k.is_active }); reload(); } catch (err) { toast(err.message, 'bad'); }
          }) }, k.is_active ? 'إخفاء' : 'إظهار')))),
        h('button.btn.sm', { onclick: () => add(mosque) }, '＋ إضافة خطيب'));
    })));
}
