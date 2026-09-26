// ما يخصّ العضو نفسه من الرواتب والورديات داخل «بياناتي»:
// مستحقاته المعتمدة وإشعار راتبه، ووردياته وبصمة حضوره وانصرافه (ملاحظتا ١١٦ و١١٧)
import { h, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { state } from '../store.js';
import { PAY_TYPE, PAYROLL_STATUS, SHIFT_STATUS, money, monthLabel, hhmm, lateText, DAY_NAMES, today, addDays } from '../pay.js';

// ---------------------------------------------------------------------
// مستحقاتي
// ---------------------------------------------------------------------
export async function salarySection() {
  const rows = await db.rpc('my_payslips').catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;

  const slip = async r => {
    const { exportPdf } = await import('../teamexport.js');
    const me = state.profile;
    const data = [
      ['البيان', 'القيمة'],
      ['العضو', me.full_name],
      ['الرقم الوظيفي', me.member_no || '—'],
      ['الشهر', monthLabel(r.period)],
      ['نوع الأجر', PAY_TYPE[r.pay_type] || r.pay_type],
      ...(r.pay_type === 'per_work' ? [['عدد الأعمال المحتسبة', String(r.works || 0)]] : []),
      ['الأساس', money(r.base) + ' ر.س'],
      ['البدلات', money(r.allowance) + ' ر.س'],
      ['الخصومات', money(r.deduction) + ' ر.س'],
      ['الصافي', money(r.total) + ' ر.س'],
      ['الحالة', (PAYROLL_STATUS[r.status] || [r.status])[0]],
      ...(r.note ? [['ملاحظة', r.note]] : [])
    ];
    if (!exportPdf(data, `إشعار راتب — ${monthLabel(r.period)}`,
      { note: `${me.full_name} — ${fmtDate(new Date())}` })) toast('اسمح بالنوافذ المنبثقة لطباعة الإشعار', 'bad');
  };

  return h('div.card.stack',
    h('div.row.between', h('h3', 'مستحقاتي'),
      h('span.badge.ok', `${list.length} كشف`)),
    h('p.small.muted', 'تظهر هنا كشوفك بعد اعتماد مدير المشروع لها. وللصرف يلزم أن يكون حسابك البنكي معتمدًا.'),
    h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الشهر', 'نوع الأجر', 'الأساس', 'بدل', 'خصم', 'الصافي', 'الحالة', ''].map(t => h('th', t)))),
      h('tbody', list.map(r => {
        const [label, kind] = PAYROLL_STATUS[r.status] || [r.status, ''];
        const btn = h('button.btn.xs', { type: 'button' }, 'إشعار الراتب');
        btn.onclick = () => busy(btn, () => slip(r));
        return h('tr',
          h('td', { 'data-label': 'الشهر' }, monthLabel(r.period)),
          h('td', { 'data-label': 'نوع الأجر' }, PAY_TYPE[r.pay_type] || r.pay_type,
            r.pay_type === 'per_work' ? h('div.small.muted', `${r.works || 0} عمل`) : null),
          h('td', { 'data-label': 'الأساس' }, money(r.base)),
          h('td', { 'data-label': 'بدل' }, money(r.allowance)),
          h('td', { 'data-label': 'خصم' }, money(r.deduction)),
          h('td', { 'data-label': 'الصافي' }, h('b', money(r.total))),
          h('td', { 'data-label': 'الحالة' }, h('span.badge', { class: kind }, label)),
          h('td', { 'data-label': '' }, btn));
      })))));
}

// ---------------------------------------------------------------------
// ورديّاتي: بصمة الحضور والانصراف من الجوال
// ---------------------------------------------------------------------
export async function shiftsSection() {
  const me = state.profile;
  const from = today(), to = addDays(from, 13);
  const first = await db.select('shifts', {
    select: '*', member_id: `eq.${me.id}`,
    and: `(shift_date.gte.${from},shift_date.lte.${to})`, order: 'shift_date.asc'
  }).catch(() => []);
  if (!first.length) return null;

  const box = h('div.card.stack');

  const paint = rows => {
    const now = rows.filter(r => r.shift_date === from);
    const next = rows.filter(r => r.shift_date > from);

    const todayBox = now.length
      ? h('div.stack', now.map(s => {
          const [label, kind] = SHIFT_STATUS[s.status] || [s.status, ''];
          const inBtn = h('button.btn.primary', { type: 'button', disabled: !!s.check_in_at }, s.check_in_at ? 'سُجّل حضورك' : 'تسجيل الحضور');
          const outBtn = h('button.btn', { type: 'button', disabled: !s.check_in_at || !!s.check_out_at }, s.check_out_at ? 'سُجّل انصرافك' : 'تسجيل الانصراف');
          inBtn.onclick = () => busy(inBtn, () => stamp(s, false));
          outBtn.onclick = () => busy(outBtn, () => stamp(s, true));
          return h('div.shift-now',
            h('div.grow',
              h('b', `${hhmm(s.start_at)} — ${hhmm(s.end_at)}`),
              h('div.small.muted', s.location || 'بلا موقع محدّد'),
              h('div.small',
                s.check_in_at ? `حضور: ${fmtDateTime(s.check_in_at)}` : 'لم يُسجّل حضورك بعد',
                s.check_out_at ? ` · انصراف: ${fmtDateTime(s.check_out_at)}` : '',
                s.late_minutes ? ` · تأخّر ${lateText(s.late_minutes)}` : '')),
            h('span.badge', { class: kind }, label),
            h('div.row', inBtn, outBtn));
        }))
      : h('p.small.muted', 'لا وردية لك اليوم.');

    box.replaceChildren(
      h('div.row.between', h('h3', 'ورديّاتي'), h('span.small.muted', fmtDate(from))),
      h('p.small.muted', 'سجّل حضورك عند وصولك موقعك، وانصرافك عند انتهاء وردِيّتك. والتسجيل يكون في يوم الوردية نفسه.'),
      todayBox,
      next.length ? h('div.stack',
        h('b.small', 'الورديات القادمة'),
        h('ul.next-shifts', next.map(s => h('li',
          h('b', DAY_NAMES[new Date(`${s.shift_date}T00:00:00`).getDay()]),
          h('span', ` ${fmtDate(s.shift_date)} · ${hhmm(s.start_at)}–${hhmm(s.end_at)}`),
          s.location ? h('span.small.muted', ` · ${s.location}`) : null)))) : null);
  };

  const reload = async () => {
    const rows = await db.select('shifts', {
      select: '*', member_id: `eq.${me.id}`,
      and: `(shift_date.gte.${today()},shift_date.lte.${addDays(today(), 13)})`, order: 'shift_date.asc'
    }).catch(() => []);
    paint(rows);
  };

  const stamp = async (s, out) => {
    try {
      await db.rpc('shift_check', { p_id: s.id, p_out: out });
      toast(out ? 'سُجّل انصرافك' : 'سُجّل حضورك', 'ok');
      await reload();
    } catch (err) { toast(err.message, 'bad'); }
  };

  paint(first);
  return box;
}
