// التقييم الأسبوعي للمرشدين: يصدر من مشرفي الهيئة، والمنصة تسجّله وتجمعه (ملاحظة ١٤٩)
//   خمسة معايير من ٥ = ٢٥ أسبوعيًّا، وأربعة أسابيع = ١٠٠ شهريًّا.
//   ونسبة الصرف تُعرض بيانًا كما في العقد، ولا تُطبَّق على أحد.
import { h, dialog, toast, busy, fmtDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';

export const CRITERIA = [
  ['appearance', 'الزيّ والمظهر'],
  ['attendance', 'الحضور والانضباط'],
  ['interaction', 'التفاعل الميداني'],
  ['language_skill', 'الكفاءة اللغوية'],
  ['compliance', 'الالتزام بالتوجيهات']
];

// جدول العقد: المتوسط الشهري ← نسبة الصرف
export const BANDS = [[90, 100], [80, 90], [70, 80], [0, 70]];
export const bandOf = avg => (avg >= 90 ? 100 : avg >= 80 ? 90 : avg >= 70 ? 80 : 70);

const ar = n => Number(n || 0).toLocaleString('en-US');
// أول يوم في أسبوع التاريخ (الاثنين، كما في date_trunc('week'))
const weekStart = d => {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const monthOf = d => String(d || '').slice(0, 7);
// الأسبوع قد يبدأ في شهرٍ وينتهي في الذي بعده، فيُحسب في الشهر الذي فيه
// أكثرُ أيامه — فلا يسقط تقييمٌ من شاشة الشهر عند مفصل الشهور.
const weekMonth = d => {
  const start = new Date(`${d}T00:00:00`);
  if (Number.isNaN(start.getTime())) return monthOf(d);
  const mid = new Date(start.getTime() + 3 * 86400000);   // رابع أيام الأسبوع
  return `${mid.getFullYear()}-${String(mid.getMonth() + 1).padStart(2, '0')}`;
};
const totalOf = r => CRITERIA.reduce((s, [k]) => s + Number(r[k] || 0), 0);

function scoreDialog(members, row = null) {
  const f = {
    member: h('select', { 'aria-label': 'المرشد' },
      h('option', { value: '' }, '— اختر المرشد —'),
      members.map(m => h('option', { value: m.id, selected: row?.member_id === m.id }, m.full_name))),
    week: h('input', { type: 'date', value: row?.week_start || new Date().toISOString().slice(0, 10),
      'aria-label': 'أسبوع التقييم' }),
    supervisor: h('input', { value: row?.supervisor_name || '', 'aria-label': 'اسم مشرف الهيئة' }),
    on: h('input', { type: 'date', value: row?.evaluated_on || '', 'aria-label': 'تاريخ التقييم' }),
    notes: h('textarea', { rows: 2, 'aria-label': 'ملاحظات المشرف' }, row?.notes || '')
  };
  const scores = {};
  for (const [k, label] of CRITERIA) {
    scores[k] = h('select', { 'aria-label': label },
      [0, 1, 2, 3, 4, 5].map(n => h('option', { value: String(n), selected: String(row?.[k] ?? 5) === String(n) }, String(n))));
  }
  const sum = h('b');
  const paint = () => { sum.textContent = `${CRITERIA.reduce((s, [k]) => s + Number(scores[k].value), 0)} من 25`; };
  for (const k of Object.keys(scores)) scores[k].onchange = paint;
  paint();

  const bad = [];
  const body = h('div.stack',
    h('p.small.muted', 'يُنقل التقييم كما ورد من مشرف الهيئة. والمنصة تسجّله وتجمعه، ولا تحتسب به أجرًا ولا تحسم به شيئًا.'),
    h('div.grid-2',
      h('label.field', req('المرشد'), f.member),
      h('label.field', req('أسبوع التقييم'), f.week),
      h('label.field', req('اسم مشرف الهيئة'), f.supervisor),
      h('label.field', 'تاريخ التقييم', f.on)),
    h('div.card.stack',
      h('div.row.between', h('b', 'المعايير الخمسة'), h('span.small.muted', 'من 0 إلى 5 لكل معيار')),
      h('div.grid-2', CRITERIA.map(([k, label]) => h('label.field', label, scores[k]))),
      h('div.row.between', h('span', 'مجموع الأسبوع'), sum)),
    h('label.field', 'ملاحظات المشرف', f.notes));

  const validate = () => {
    bad.forEach(el => markBad(el, false)); bad.length = 0;
    const need = (el, cond, msg) => { if (cond) { bad.push(el); markBad(el, true); return msg; } return null; };
    const errs = [
      need(f.member, !f.member.value, 'اختر المرشد'),
      need(f.week, !f.week.value, 'حدّد أسبوع التقييم'),
      need(f.supervisor, !f.supervisor.value.trim(), 'اكتب اسم مشرف الهيئة الذي أصدر التقييم')
    ].filter(Boolean);
    return errs.length ? errs[0] : true;
  };

  return dialog({
    title: row ? 'تعديل تقييم أسبوع' : 'تسجيل تقييم أسبوعي',
    body,
    buttons: [
      { label: 'إلغاء', value: null },
      { label: 'حفظ', kind: 'primary', validate, value: () => ({
        id: row?.id || null, member_id: f.member.value, week_start: weekStart(f.week.value),
        supervisor_name: f.supervisor.value.trim(), evaluated_on: f.on.value || null,
        notes: f.notes.value.trim(),
        ...Object.fromEntries(CRITERIA.map(([k]) => [k, Number(scores[k].value)]))
      }) }
    ]
  });
}

export async function render() {
  const admin = isAdmin();
  const [rows, members] = await Promise.all([
    db.select('field_evaluations', { select: '*', order: 'week_start.desc' }).catch(() => []),
    db.select('profiles', { select: 'id,full_name,track,status', status: 'eq.active', track: 'eq.field', order: 'full_name' })
      .catch(() => [])
  ]);
  const nameOf = id => members.find(m => m.id === id)?.full_name || '—';

  const monthIn = h('input', { type: 'month', value: new Date().toISOString().slice(0, 7), 'aria-label': 'الشهر' });
  const table = h('div.stack');
  const monthly = h('div.stack');

  const reload = async () => {
    const fresh = await db.select('field_evaluations', { select: '*', order: 'week_start.desc' }).catch(() => []);
    rows.length = 0; rows.push(...fresh); draw();
  };

  const edit = async row => {
    const p = await scoreDialog(members, row);
    if (!p) return;
    try { await db.rpc('save_field_evaluation', { p }); toast('سُجِّل التقييم.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const remove = async row => {
    const ok = await dialog({ title: 'حذف التقييم',
      body: h('p', `يُحذف تقييم ${nameOf(row.member_id)} لأسبوع ${fmtDate(row.week_start)}؟`),
      buttons: [{ label: 'إلغاء', value: false }, { label: 'حذف', kind: 'bad', value: true }] });
    if (!ok) return;
    try { await db.rpc('delete_field_evaluation', { p_id: row.id }); toast('حُذف التقييم.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  function draw() {
    const list = rows.filter(r => !monthIn.value || weekMonth(r.week_start) === monthIn.value);
    const head = ['الأسبوع', 'المرشد', ...CRITERIA.map(([, l]) => l), 'المجموع', 'المشرف', ...(admin ? [''] : [])];
    table.replaceChildren(h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', head.map(t => h('th', t)))),
      h('tbody', list.length ? list.map(r => h('tr',
        h('td', { 'data-label': 'الأسبوع' }, fmtDate(r.week_start)),
        h('td', { 'data-label': 'المرشد' }, nameOf(r.member_id)),
        ...CRITERIA.map(([k, l]) => h('td', { 'data-label': l }, String(r[k] ?? '—'))),
        h('td', { 'data-label': 'المجموع' }, h('b', `${totalOf(r)}/25`)),
        h('td', { 'data-label': 'المشرف' }, r.supervisor_name,
          r.notes ? h('span.small.muted', ` — ${r.notes}`) : null),
        admin ? h('td.row', { 'data-label': '' },
          h('button.btn.xs', { type: 'button', onclick: () => edit(r) }, 'تعديل'),
          h('button.btn.xs.bad', { type: 'button', onclick: () => remove(r) }, 'حذف')) : null))
        : [h('tr', h('td', { colspan: String(head.length) },
            h('p.muted', 'لا تقييمات مسجَّلة في هذا الشهر.')))]))));

    // متوسط الشهر لكل مرشد ونسبة الصرف المقابلة — بيانٌ لا تطبيق
    const ids = [...new Set(list.map(r => r.member_id))];
    const mHead = ['المرشد', 'الأسابيع المسجَّلة', 'مجموع الدرجات', 'المتوسط الشهري من 100', 'نسبة الصرف المقابلة'];
    monthly.replaceChildren(h('section.card.stack',
      h('h3', 'متوسط الشهر ونسبة الصرف المقابلة في العقد'),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', mHead.map(t => h('th', t)))),
        h('tbody', ids.length ? ids.map(id => {
          const l = list.filter(r => r.member_id === id);
          const total = l.reduce((s, r) => s + totalOf(r), 0);
          const avg = Math.round((total * 4 / l.length) * 10) / 10;
          const band = bandOf(avg);
          return h('tr',
            h('td', { 'data-label': 'المرشد' }, nameOf(id)),
            h('td', { 'data-label': 'الأسابيع المسجَّلة' }, ar(l.length)),
            h('td', { 'data-label': 'مجموع الدرجات' }, `${ar(total)} من ${ar(l.length * 25)}`),
            h('td', { 'data-label': 'المتوسط الشهري من 100' }, h('b', String(avg))),
            h('td', { 'data-label': 'نسبة الصرف المقابلة' },
              h('span.badge', { class: band === 100 ? 'ok' : band >= 80 ? 'gold' : 'bad' }, `${band}٪`),
              avg < 70 ? h('span.small.bad', ' — يقترن بإنذار في العقد') : null));
        }) : [h('tr', h('td', { colspan: String(mHead.length) }, h('p.muted', 'لا بيانات.')))]))),
      h('p.small.muted', 'هذه نسبٌ استرشادية من جدول العقد، تُرفق بمسودّة المستخلص للإدارة. '
        + 'ولا تُطبَّق على أجر أحد في المنصة: أجور الفريق شهرية أو مقطوعة كما ضُبطت.')));
  }

  monthIn.onchange = draw;

  const addBtn = admin ? h('button.btn.sm.primary', { type: 'button' }, '+ تسجيل تقييم') : null;
  if (addBtn) addBtn.onclick = () => edit(null);

  const fmtSel = h('select', { 'aria-label': 'صيغة التصدير' },
    h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
    h('option', { value: 'docx' }, 'Word على كليشة الهيئة'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
  const expBtn = h('button.btn.sm', { type: 'button' }, 'تصدير التقييم');
  expBtn.onclick = () => busy(expBtn, async () => {
    const list = rows.filter(r => !monthIn.value || weekMonth(r.week_start) === monthIn.value);
    const out = [['الأسبوع', 'المرشد', ...CRITERIA.map(([, l]) => l), 'المجموع', 'مشرف الهيئة', 'ملاحظات']];
    for (const r of list) {
      out.push([r.week_start, nameOf(r.member_id), ...CRITERIA.map(([k]) => String(r[k] ?? '')),
        `${totalOf(r)}/25`, r.supervisor_name, r.notes || '']);
    }
    const title = `تقييم المرشدين — ${monthIn.value}`;
    try {
      if (fmtSel.value === 'xlsx') downloadBlob(buildXlsx(out, { sheetName: 'التقييم', allText: true }), `${title}.xlsx`);
      else {
        const { exportWord, exportPdf } = await import('../teamexport.js');
        const note = 'التقييم وارد من مشرفي الهيئة، والمنصة تسجّله ولا تحتسب به أجرًا.';
        if (fmtSel.value === 'docx') await exportWord(out, title, { note });
        else if (!exportPdf(out, title, { note })) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  draw();

  return h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, fmtSel, expBtn, addBtn),
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'تقييم المرشدين'),
        h('p.muted', 'التقييم الأسبوعي الوارد من مشرفي الهيئة: خمسة معايير من 5 أسبوعيًّا، ومجموع الشهر من 100.'))),
    h('div.card.stack', h('label.field', { style: { maxWidth: '18rem' } }, 'الشهر', monthIn)),
    table,
    monthly);
}
