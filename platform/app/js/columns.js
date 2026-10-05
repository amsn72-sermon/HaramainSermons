// اختيارُ أعمدة التصدير وترتيبُها (ملاحظتا ٢٤٠ و٢٤٣)
//   كشوفُنا تطول أعمدتُها، وليس كلُّ كشفٍ يُقدَّم بكلِّ أعمدته. فتسبق
//   التصديرَ نافذةٌ تُنتقى فيها الأعمدة وتُرتَّب بالسحب، ويُضاف فيها عمودٌ
//   باسمٍ يكتبه المستخدم يخرج فارغًا ليُملأ بعد التصدير. ويُحفظ ذلك كلُّه
//   لكلِّ كشفٍ على حدة فلا يُعاد في كل مرة. وما قام عليه الكشفُ من أعمدةٍ
//   لا يُطفأ، فالكشفُ بلا عموده الأساسي لا يُقرأ.
import { h, dialog } from './ui.js';

const KEY = k => `hs.cols.${k}`;

// عمودٌ مضافٌ يُعرف ببادئته، واسمُه ما بعدها
export const EXTRA = '+';
export const isExtra = k => String(k).startsWith(EXTRA);
export const extraLabel = k => String(k).slice(EXTRA.length);
export const colLabel = (columns, k) => (isExtra(k)
  ? extraLabel(k)
  : (columns.find(c => c.key === k)?.label ?? k));

const read = key => {
  try { return JSON.parse(localStorage.getItem(KEY(key)) || 'null'); } catch { return null; }
};

// الاختيارُ المحفوظ بترتيبه، أو الأعمدةُ كلُّها إن لم يُحفظ شيء
export function savedColumns(key, columns, required = []) {
  const all = columns.map(c => c.key);
  const saved = read(key);
  const list = Array.isArray(saved) ? saved : null;
  if (!list || !list.length) return all;
  // ما زال موجودًا في الكشف، أو عمودٌ مضاف
  const keep = list.filter(k => isExtra(k) || all.includes(k));
  // الأعمدةُ الأساسيةُ لا تُطفأ ولو غابت عن المحفوظ
  for (const r of required) if (!keep.includes(r)) keep.unshift(r);
  return keep.length ? keep : all;
}

export function rememberColumns(key, keys) {
  try { localStorage.setItem(KEY(key), JSON.stringify(keys)); } catch { /* تخزينٌ غير متاح */ }
}

// نافذةُ الاختيار: تُعيد مصفوفةَ المفاتيح بالترتيب المختار، أو null عند الإلغاء
export async function pickColumns({ key, title = 'أعمدة التصدير', columns, required = [],
                                    note = '' } = {}) {
  // الحالُ الداخلية: ترتيبٌ كاملٌ لكلِّ عمود، ومن المختار منها
  const saved = savedColumns(key, columns, required);
  const order = [...saved];
  for (const c of columns) if (!order.includes(c.key)) order.push(c.key);
  const chosen = new Set(saved);
  for (const r of required) chosen.add(r);

  const listEl = h('div.col-picker.col-sort');
  const count = h('span.small.muted');
  let dragKey = null;

  const paint = () => {
    count.textContent = `${order.filter(k => chosen.has(k)).length} عمودًا من ${order.length}`;
  };

  const move = (from, to) => {
    if (from === to || from < 0 || to < 0) return;
    const [k] = order.splice(from, 1);
    order.splice(to, 0, k);
    draw();
  };

  const draw = () => {
    listEl.replaceChildren(...order.map((k, i) => {
      const must = required.includes(k);
      const cb = h('input', { type: 'checkbox',
        checked: (must || chosen.has(k)) ? true : null,
        disabled: must ? true : null, 'aria-label': colLabel(columns, k) });
      cb.addEventListener('change', () => {
        cb.checked ? chosen.add(k) : chosen.delete(k);
        paint();
      });

      const up = h('button.btn.xs.ghost', { type: 'button', title: 'قدّمه', 'aria-label': 'قدّم العمود' }, '▲');
      up.onclick = () => move(i, i - 1);
      const down = h('button.btn.xs.ghost', { type: 'button', title: 'أخّره', 'aria-label': 'أخّر العمود' }, '▼');
      down.onclick = () => move(i, i + 1);

      const row = h('div.col-pick', { draggable: 'true' },
        h('span.col-grip', { title: 'اسحب لترتيبه', 'aria-hidden': 'true' }, '⠿'),
        h('label.check', cb, h('span', colLabel(columns, k))),
        must ? h('span.badge', 'أساسي') : (isExtra(k) ? h('span.badge.gold', 'مضاف') : null),
        h('div.row', { style: { marginInlineStart: 'auto' } },
          up, down,
          isExtra(k) ? h('button.btn.xs.ghost', { type: 'button', title: 'احذف العمود',
            onclick: () => { order.splice(i, 1); chosen.delete(k); draw(); paint(); } }, '✕') : null));

      row.addEventListener('dragstart', e => { dragKey = k; e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { dragKey = null; row.classList.remove('dragging'); });
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', e => {
        e.preventDefault(); row.classList.remove('over');
        if (dragKey === null) return;
        move(order.indexOf(dragKey), i);
      });
      return row;
    }));
    paint();
  };
  draw();

  const all = h('button.btn.xs', { type: 'button', onclick: () => {
    order.forEach(k => chosen.add(k)); draw();
  } }, 'حدّد الكل');
  const none = h('button.btn.xs.ghost', { type: 'button', onclick: () => {
    order.forEach(k => { if (!required.includes(k)) chosen.delete(k); }); draw();
  } }, 'ألغِ التحديد');

  // عمودٌ يُضاف باسمه، ويخرج فارغًا (ملاحظة ٢٤٣)
  const addBtn = h('button.btn.xs.primary', { type: 'button' }, '＋ عمود');
  addBtn.onclick = async () => {
    const nameIn = h('input', { 'aria-label': 'اسم العمود', placeholder: 'مثل: رقم الأمر' });
    const name = await dialog({
      title: 'عمودٌ يُضاف إلى الكشف',
      body: h('div.stack',
        h('p.small.muted', 'يخرج العمودُ فارغًا في الكشف ليُملأ يدويًّا بعد التصدير. '
          + 'ويُحفظ مع اختيارك لهذا الكشف.'),
        h('label.field', 'اسم العمود', nameIn)),
      buttons: [
        { label: 'أضِف', kind: 'primary',
          validate: () => {
            const v = nameIn.value.trim();
            if (!v) return 'اكتب اسم العمود';
            if (order.includes(EXTRA + v)) return 'هذا العمود مضافٌ سلفًا';
            return true;
          },
          value: () => nameIn.value.trim() },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!name) return;
    const k = EXTRA + name;
    order.push(k); chosen.add(k); draw();
  };

  const res = await dialog({
    title,
    body: h('div.stack',
      h('p.small.muted', note || 'اختر ما يُصدَّر، ورتّبه بالسحب أو بالسهمين. '
        + 'ويُحفظ اختيارُك وترتيبُك لهذا الكشف فلا تعيدهما في كل مرة.'),
      h('div.row.between.wrap', count, h('div.row', addBtn, all, none)),
      listEl),
    buttons: [
      { label: 'صدّر', kind: 'primary',
        validate: () => (order.some(k => required.includes(k) || chosen.has(k))
          ? true : 'اختر عمودًا واحدًا على الأقل'),
        value: () => order.filter(k => required.includes(k) || chosen.has(k)) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (res) rememberColumns(key, res);
  return res;
}

// تنقيةُ جدولٍ جاهز (أولُ صفٍّ رؤوسٌ) على الأعمدة المختارة وبترتيبها،
// والعمودُ المضافُ يخرج باسمه في الرأس وفارغًا فيما دونه
export function narrowSheet(rows, columns, keys) {
  const pos = new Map(columns.map((c, i) => [c.key, i]));
  return rows.map((r, ri) => keys.map(k => {
    if (isExtra(k)) return ri === 0 ? extraLabel(k) : '';
    const i = pos.get(k);
    return i === undefined ? '' : r[i];
  }));
}
