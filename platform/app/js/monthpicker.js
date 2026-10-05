// منتقي الشهر من تقويم (ملاحظة ٢٤٨)
//   كان الشهرُ يُكتب `2026-10` بيدٍ فيُخطئ فيه الكاتبُ ولا يرى ما قبله ولا
//   ما بعده. فصار تقويمًا: السنةُ بسهمين، والأشهرُ الاثنا عشرَ بأسمائها،
//   وما فيه عملٌ مُعلَّمٌ بنقطة، وما خرج عن المدة لا يُضغط.
//
//   يُستعمل كما يُستعمل حقلُ الشهر: له `.value` تُقرأ وتُكتب، ويُطلق
//   حدثَ `change` فتعمل المستمعاتُ القائمةُ كما هي.
import { h } from './ui.js';

export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const pad = n => String(n).padStart(2, '0');
export const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
export const thisMonthKey = () => new Date().toISOString().slice(0, 7);

export function monthLabelOf(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

// opts: { value, min, max, marked: [«YYYY-MM»…], label }
export function monthField({ value = thisMonthKey(), min = null, max = null,
                             marked = [], label = 'الشهر' } = {}) {
  // القيمةُ الفارغةُ مقبولة: حقلٌ لم يُحدَّد بعدُ (شهرُ بداية العقد مثلًا)
  let cur = /^\d{4}-\d{2}$/.test(String(value)) ? String(value)
    : (value === '' || value === null ? '' : thisMonthKey());
  let year = Number((cur || thisMonthKey()).slice(0, 4));
  let open = false;
  let marks = new Set(marked || []);

  const btn = h('button.btn.month-btn', { type: 'button', 'aria-haspopup': 'dialog',
    'aria-label': label });
  const pop = h('div.mp-pop', { hidden: true, role: 'dialog', 'aria-label': label });
  const wrap = h('span.mp-wrap', btn, pop);

  const inRange = k => (!min || k >= min) && (!max || k <= max);

  const paintBtn = () => { btn.textContent = cur ? `📅 ${monthLabelOf(cur)}` : '📅 حدّد الشهر'; };

  const draw = () => {
    const prev = h('button.btn.xs', { type: 'button', 'aria-label': 'السنة السابقة' }, '‹');
    prev.onclick = () => { year--; draw(); };
    const next = h('button.btn.xs', { type: 'button', 'aria-label': 'السنة التالية' }, '›');
    next.onclick = () => { year++; draw(); };
    const grid = h('div.mp-grid', MONTHS.map((nm, i) => {
      const k = monthKey(year, i);
      const b = h('button.mp-m', {
        type: 'button',
        class: [k === cur ? 'on' : '', marks.has(k) ? 'has' : ''].filter(Boolean).join(' '),
        disabled: inRange(k) ? null : true,
        title: marks.has(k) ? 'فيه عمل' : null
      }, nm);
      b.onclick = () => { set(k); close(); };
      return b;
    }));
    const now = h('button.btn.xs.ghost', { type: 'button' }, 'الشهر الجاري');
    now.onclick = () => { const k = thisMonthKey(); if (inRange(k)) { set(k); close(); } };
    pop.replaceChildren(
      h('div.mp-head', prev, h('b', String(year)), next),
      grid,
      h('div.row.center', { style: { marginTop: '8px' } }, now));
  };

  const set = (k, quiet = false) => {
    if (k === '' || k === null || k === undefined) {
      cur = '';
      paintBtn();
      if (!quiet) wrap.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    cur = k; year = Number(k.slice(0, 4));
    paintBtn();
    if (!quiet) wrap.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const close = () => { open = false; pop.hidden = true; };
  const onDoc = e => { if (open && !wrap.contains(e.target)) close(); };
  document.addEventListener('click', onDoc);

  btn.onclick = () => {
    open = !open;
    pop.hidden = !open;
    if (open) draw();
  };

  Object.defineProperty(wrap, 'value', {
    get: () => cur,
    set: v => set(v, true)
  });
  wrap.setMarked = list => { marks = new Set(list || []); if (open) draw(); };
  wrap.setRange = (lo, hi) => { min = lo; max = hi; if (open) draw(); };
  wrap.destroy = () => document.removeEventListener('click', onDoc);

  paintBtn();
  return wrap;
}
