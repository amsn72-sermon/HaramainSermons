// اختيارُ أعمدة التصدير (ملاحظة ٢٤٠)
//   كشوفُنا تطول أعمدتُها، وليس كلُّ كشفٍ يُقدَّم بكلِّ أعمدته. فتسبق
//   التصديرَ نافذةٌ تُنتقى فيها الأعمدة، ويُحفظ الاختيارُ لكلِّ كشفٍ على
//   حدة فلا يُعاد في كل مرة. وما قام عليه الكشفُ من أعمدةٍ لا يُطفأ،
//   فالكشفُ بلا عموده الأساسي لا يُقرأ.
import { h, dialog } from './ui.js';

const KEY = k => `hs.cols.${k}`;

// الاختيارُ المحفوظ، أو الأعمدةُ كلُّها إن لم يُحفظ شيء
export function savedColumns(key, columns, required = []) {
  const all = columns.map(c => c.key);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY(key)) || 'null'); } catch { saved = null; }
  if (!Array.isArray(saved) || !saved.length) return all;
  const keep = saved.filter(k => all.includes(k));
  const out = all.filter(k => keep.includes(k) || required.includes(k));
  return out.length ? out : all;
}

export function rememberColumns(key, keys) {
  try { localStorage.setItem(KEY(key), JSON.stringify(keys)); } catch { /* تخزينٌ غير متاح */ }
}

// نافذةُ الاختيار: تُعيد مصفوفةَ المفاتيح بترتيب الجدول، أو null عند الإلغاء
export async function pickColumns({ key, title = 'أعمدة التصدير', columns, required = [],
                                    note = '' } = {}) {
  const chosen = new Set(savedColumns(key, columns, required));
  const count = h('span.small.muted');
  const boxes = columns.map(c => {
    const must = required.includes(c.key);
    const cb = h('input', { type: 'checkbox', value: c.key,
      checked: (must || chosen.has(c.key)) ? true : null,
      disabled: must ? true : null, 'aria-label': c.label });
    cb.addEventListener('change', () => {
      cb.checked ? chosen.add(c.key) : chosen.delete(c.key);
      paint();
    });
    return h('label.check.col-pick', cb, h('span', c.label),
      must ? h('span.badge', 'أساسي') : null);
  });
  const paint = () => {
    const n = columns.filter(c => required.includes(c.key) || chosen.has(c.key)).length;
    count.textContent = `${n} عمودًا من ${columns.length}`;
  };
  paint();

  const all = h('button.btn.xs', { type: 'button', onclick: () => {
    columns.forEach(c => chosen.add(c.key));
    boxes.forEach(b => { const i = b.querySelector('input'); if (!i.disabled) i.checked = true; });
    paint();
  } }, 'حدّد الكل');
  const none = h('button.btn.xs.ghost', { type: 'button', onclick: () => {
    columns.forEach(c => { if (!required.includes(c.key)) chosen.delete(c.key); });
    boxes.forEach(b => { const i = b.querySelector('input'); if (!i.disabled) i.checked = false; });
    paint();
  } }, 'ألغِ التحديد');

  const res = await dialog({
    title,
    body: h('div.stack',
      h('p.small.muted', note || 'اختر ما يُصدَّر. والأعمدةُ تخرج بترتيب الجدول، '
        + 'ويُحفظ اختيارُك لهذا الكشف فلا تعيده في كل مرة.'),
      h('div.row.between', count, h('div.row', all, none)),
      h('div.col-picker', boxes)),
    buttons: [
      { label: 'صدّر', kind: 'primary',
        validate: () => (columns.some(c => required.includes(c.key) || chosen.has(c.key))
          ? true : 'اختر عمودًا واحدًا على الأقل'),
        value: () => columns.filter(c => required.includes(c.key) || chosen.has(c.key))
          .map(c => c.key) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (res) rememberColumns(key, res);
  return res;
}

// تنقيةُ جدولٍ جاهز (أولُ صفٍّ رؤوسٌ) على الأعمدة المختارة
export function narrowSheet(rows, columns, keys) {
  const idx = columns.map((c, i) => (keys.includes(c.key) ? i : -1)).filter(i => i >= 0);
  return rows.map(r => idx.map(i => r[i]));
}
