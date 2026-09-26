// الرواتب والمستحقات: أجر كل عضو، ثم دورة شهرية تُحتسب من الأعمال المنجزة،
// تُعتمد من مدير المشروع وتُصدَّر كشفًا للمالية (ملاحظة ١١٦)
import { h, toast, busy, confirm, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { isManager, ROLE_LABEL } from '../store.js';
import { PAY_TYPE, PAYROLL_STATUS, money, monthLabel, monthStart, thisMonth } from '../pay.js';
import { exportExcel, exportPdf } from '../teamexport.js';

const groupOf = m => (['manager', 'coordinator'].includes(m.role) ? 'إداري'
  : m.track === 'field' ? 'مرشد مكاني' : 'مترجم متخصص');

export async function render(ctx) {
  const want = ctx.query?.get('tab') === 'rates' ? 'rates' : 'cycle';

  const [members, pays, cycles] = await Promise.all([
    db.select('profiles', { select: 'id,full_name,member_no,role,track,status', status: 'eq.active', order: 'full_name.asc' }),
    db.select('member_pay', { select: '*' }).catch(() => []),
    db.select('payrolls', { select: '*', order: 'period.desc' }).catch(() => [])
  ]);
  const payOf = new Map(pays.map(p => [p.member_id, p]));

  const panel = h('div.staff-panel');
  const TABS = [['cycle', 'الدورة الشهرية'], ['rates', 'أجور الأعضاء']];
  let current = want;
  const btns = TABS.map(([key, label]) => {
    const b = h('button.btn.tab', { type: 'button', role: 'tab' }, label);
    b.onclick = () => show(key);
    return b;
  });

  async function show(key) {
    current = key;
    btns.forEach((b, i) => {
      const on = TABS[i][0] === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    history.replaceState(null, '', key === 'cycle' ? '/app/payroll' : '/app/payroll?tab=rates');
    panel.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    try {
      panel.replaceChildren(key === 'rates' ? ratesSection(members, payOf) : await cycleSection(cycles, members));
    } catch (err) { panel.replaceChildren(h('p.small.bad', err.message)); }
  }

  const view = h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', 'الرواتب والمستحقات'),
      h('p.muted', 'المرشدون المكانيون بأجر شهري، والمترجمون المتخصصون بين شهري ومقطوع لكل عمل. والدورة تُحتسب من الأعمال المنجزة في الشهر، ولا تُصرف قبل اعتماد مدير المشروع.'))),
    h('div.tabs', { role: 'tablist' }, btns),
    panel);
  await show(current);
  return view;
}

// ---------------------------------------------------------------------
// أجور الأعضاء: يضبطها مدير المشروع، والمنسق يقرأ فقط
// ---------------------------------------------------------------------
function ratesSection(members, payOf) {
  const mine = isManager();
  const rows = members.map(m => {
    const p = payOf.get(m.id) || { pay_type: 'none', monthly: 0, per_work: 0, note: '' };
    const type = h('select', { 'aria-label': `نوع أجر ${m.full_name}`, disabled: !mine },
      Object.entries(PAY_TYPE).map(([v, l]) => h('option', { value: v }, l)));
    type.value = p.pay_type || 'none';
    const monthly = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !mine,
      'aria-label': `الأجر الشهري لـ${m.full_name}`, value: Number(p.monthly || 0) || '' });
    const perWork = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !mine,
      'aria-label': `المقطوع لكل عمل لـ${m.full_name}`, value: Number(p.per_work || 0) || '' });
    const note = h('input', { maxlength: 200, disabled: !mine, 'aria-label': `ملاحظة أجر ${m.full_name}`, value: p.note || '' });
    const sync = () => {
      monthly.disabled = !mine || type.value !== 'monthly';
      perWork.disabled = !mine || type.value !== 'per_work';
    };
    type.addEventListener('change', sync);
    sync();

    const save = h('button.btn.sm.primary', { type: 'button' }, 'حفظ');
    save.onclick = () => busy(save, async () => {
      await db.rpc('set_member_pay', {
        p_member: m.id, p_type: type.value,
        p_monthly: type.value === 'monthly' ? Number(monthly.value || 0) : 0,
        p_per_work: type.value === 'per_work' ? Number(perWork.value || 0) : 0,
        p_note: note.value || null
      });
      payOf.set(m.id, { member_id: m.id, pay_type: type.value, monthly: monthly.value, per_work: perWork.value, note: note.value });
      toast('حُفظ أجر ' + m.full_name, 'ok');
    });

    return h('tr',
      h('td', { 'data-label': 'العضو' }, h('b', m.full_name), h('div.small.muted', m.member_no || '—')),
      h('td', { 'data-label': 'الفريق' }, groupOf(m), h('div.small.muted', ROLE_LABEL[m.role])),
      h('td', { 'data-label': 'نوع الأجر' }, type),
      h('td', { 'data-label': 'الشهري' }, monthly),
      h('td', { 'data-label': 'المقطوع لكل عمل' }, perWork),
      h('td', { 'data-label': 'ملاحظة' }, note),
      h('td', { 'data-label': '' }, mine ? save : h('span.small.muted', 'للمدير')));
  });

  return h('div.stack',
    h('p.small.muted', mine
      ? 'المقطوع يُضرب في عدد المراحل التي أنجزها العضو خلال الشهر، والشهري ثابت لا يتأثر بعدد الأعمال.'
      : 'ضبط الأجور لمدير المشروع وحده، وهي معروضة لك للاطّلاع وإعداد الكشوف.'),
    h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'الفريق', 'نوع الأجر', 'الشهري', 'المقطوع لكل عمل', 'ملاحظة', ''].map(t => h('th', t)))),
      h('tbody', rows))));
}

// ---------------------------------------------------------------------
// الدورة الشهرية
// ---------------------------------------------------------------------
async function cycleSection(cycles, members) {
  const box = h('div.stack');
  const month = h('input', { type: 'month', value: cycles[0] ? String(cycles[0].period).slice(0, 7) : thisMonth(),
    'aria-label': 'شهر الدورة' });
  const build = h('button.btn.primary', { type: 'button' }, 'احتساب الدورة');
  const body = h('div.stack');

  const known = new Map(cycles.map(c => [String(c.period).slice(0, 7), c]));
  const pick = h('select', { 'aria-label': 'دورة محفوظة' },
    h('option', { value: '' }, 'الدورات المحفوظة'),
    cycles.map(c => h('option', { value: String(c.period).slice(0, 7) }, monthLabel(c.period))));
  pick.onchange = () => { if (pick.value) { month.value = pick.value; open(pick.value); } };

  build.onclick = () => busy(build, async () => {
    const period = monthStart(month.value);
    if (!period) return toast('اختر الشهر أولًا', 'bad');
    await db.rpc('build_payroll', { p_period: period });
    toast('احتُسبت دورة ' + monthLabel(period), 'ok');
    await open(month.value, true);
  });

  async function open(m, fresh = false) {
    body.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    const period = monthStart(m);
    const [rowCycle] = await db.select('payrolls', { select: '*', period: `eq.${period}` }).catch(() => []);
    if (!rowCycle) {
      body.replaceChildren(h('div.empty', h('b', 'لا دورة لهذا الشهر بعد'),
        h('span', 'اضغط «احتساب الدورة» لبناء بنودها من أجور الأعضاء وأعمالهم المنجزة.')));
      return;
    }
    if (fresh) known.set(m, rowCycle);
    const sheet = await db.select('payroll_sheet', { select: '*', payroll_id: `eq.${rowCycle.id}`, order: 'full_name.asc' });
    body.replaceChildren(cycleCard(rowCycle, sheet, () => open(m, true), members));
  }

  box.append(
    h('div.card.stack',
      h('div.row.wrap',
        h('label.field', 'الشهر', month),
        h('label.field', 'دورة محفوظة', pick),
        h('div.grow'),
        build)),
    body);

  await open(month.value);
  return box;
}

function cycleCard(cycle, sheet, reload, members) {
  const [label, kind] = PAYROLL_STATUS[cycle.status] || [cycle.status, ''];
  const draft = cycle.status === 'draft';
  const mgr = isManager();
  const total = sheet.reduce((s, r) => s + Number(r.total || 0), 0);
  const unverified = sheet.filter(r => Number(r.total || 0) > 0 && !r.bank_verified).length;
  const byId = new Map(members.map(m => [m.id, m]));

  const rows = sheet.map((r, i) => {
    const allowance = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !draft,
      'aria-label': `بدل ${r.full_name}`, value: Number(r.allowance || 0) || '' });
    const deduction = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !draft,
      'aria-label': `خصم ${r.full_name}`, value: Number(r.deduction || 0) || '' });
    const note = h('input', { maxlength: 200, disabled: !draft, 'aria-label': `سبب البدل أو الخصم لـ${r.full_name}`, value: r.note || '' });
    const totalCell = h('b', money(r.total));
    const paint = () => {
      totalCell.textContent = money(Number(r.base || 0) + Number(allowance.value || 0) - Number(deduction.value || 0));
    };
    allowance.addEventListener('input', paint);
    deduction.addEventListener('input', paint);

    const save = h('button.btn.sm', { type: 'button' }, 'حفظ');
    save.onclick = () => busy(save, async () => {
      if ((Number(deduction.value || 0) > 0 || Number(allowance.value || 0) > 0) && !note.value.trim()) {
        return toast('اكتب سبب البدل أو الخصم', 'bad');
      }
      await db.rpc('set_payroll_item', { p_payroll: cycle.id, p_member: r.member_id,
        p_allowance: Number(allowance.value || 0), p_deduction: Number(deduction.value || 0), p_note: note.value || null });
      toast('حُفظ بند ' + r.full_name, 'ok');
    });

    const m = byId.get(r.member_id);
    return h('tr',
      h('td.n', { 'data-label': 'م' }, String(i + 1)),
      h('td', { 'data-label': 'العضو' }, h('b', r.full_name),
        h('div.small.muted', [m ? groupOf(m) : null, r.member_no].filter(Boolean).join(' · ') || '—')),
      h('td', { 'data-label': 'نوع الأجر' }, PAY_TYPE[r.pay_type] || r.pay_type),
      h('td', { 'data-label': 'الأعمال' }, r.pay_type === 'per_work' ? String(r.works || 0) : '—'),
      h('td', { 'data-label': 'الأساس' }, money(r.base)),
      h('td', { 'data-label': 'بدل' }, allowance),
      h('td', { 'data-label': 'خصم' }, deduction),
      h('td', { 'data-label': 'السبب' }, note),
      h('td', { 'data-label': 'الإجمالي' }, totalCell),
      h('td', { 'data-label': 'الحساب البنكي' }, r.iban
        ? h('span', h('span.small', { dir: 'ltr' }, r.iban),
            r.bank_verified ? h('span.badge.ok', 'معتمَد') : h('span.badge.warn', 'تحت المراجعة'))
        : h('span.badge.bad', 'لا حساب مسجّل')),
      draft ? h('td', { 'data-label': '' }, save) : null);
  });

  const head = ['م', 'العضو', 'نوع الأجر', 'الأعمال', 'الأساس', 'بدل', 'خصم', 'السبب', 'الإجمالي', 'الحساب البنكي'];
  if (draft) head.push('');

  // كشف المالية: الأسماء والمبالغ والحسابات المعتمدة
  const sheetRows = () => [
    ['العضو', 'الرقم', 'نوع الأجر', 'الأعمال', 'الأساس', 'بدل', 'خصم', 'الإجمالي', 'البنك', 'الآيبان', 'حالة الحساب', 'السبب'],
    ...sheet.map(r => [r.full_name, r.member_no || '', PAY_TYPE[r.pay_type] || r.pay_type,
      r.pay_type === 'per_work' ? String(r.works || 0) : '', money(r.base), money(r.allowance), money(r.deduction),
      money(r.total), r.bank_name || '', r.iban || '', r.iban ? (r.bank_verified ? 'معتمَد' : 'تحت المراجعة') : 'لا حساب',
      r.note || '']),
    ['الإجمالي العام', '', '', '', '', '', '', money(total), '', '', '', '']
  ];
  const title = `كشف رواتب ${monthLabel(cycle.period)}`;
  const note = `عدد المستحقين: ${sheet.length} — الإجمالي: ${money(total)} ر.س — الحالة: ${label}`;

  const actions = h('div.row.wrap',
    h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheetRows(), title) }, 'تصدير Excel'),
    h('button.btn.sm', { type: 'button', onclick: () => { if (!exportPdf(sheetRows(), title, { note })) toast('اسمح بالنوافذ المنبثقة لتصدير الكشف', 'bad'); } }, 'كشف PDF على الكليشة'));

  if (mgr && draft) {
    const ok = h('button.btn.sm.primary', { type: 'button' }, 'اعتماد الدورة');
    ok.onclick = () => busy(ok, async () => {
      if (!await confirm('اعتماد الدورة', `سيُعتمد كشف ${monthLabel(cycle.period)} بإجمالي ${money(total)} ر.س، ولا تُعدَّل بنوده بعد الاعتماد.`, 'اعتماد')) return;
      await db.rpc('set_payroll_status', { p_payroll: cycle.id, p_status: 'approved' });
      toast('اعتُمدت الدورة', 'ok');
      await reload();
    });
    actions.prepend(ok);
  }
  if (mgr && cycle.status === 'approved') {
    const paid = h('button.btn.sm.primary', { type: 'button' }, 'تعليمها مصروفة');
    paid.onclick = () => busy(paid, async () => {
      await db.rpc('set_payroll_status', { p_payroll: cycle.id, p_status: 'paid' });
      toast('عُلّمت الدورة مصروفة', 'ok');
      await reload();
    });
    const back = h('button.btn.sm.ghost', { type: 'button' }, 'إرجاعها مسودة');
    back.onclick = () => busy(back, async () => {
      if (!await confirm('إرجاع الدورة', 'تُعاد الدورة مسودةً فتُعدَّل بنودها من جديد.', 'إرجاع')) return;
      await db.rpc('set_payroll_status', { p_payroll: cycle.id, p_status: 'draft' });
      await reload();
    });
    actions.prepend(paid, back);
  }

  return h('div.card.stack',
    h('div.row.between.wrap',
      h('div', h('h3', title), h('div.small.muted',
        [`بنود: ${sheet.length}`, cycle.approved_at ? 'اعتُمدت ' + fmtDateTime(cycle.approved_at) : null,
          cycle.paid_at ? 'صُرفت ' + fmtDateTime(cycle.paid_at) : null].filter(Boolean).join(' · '))),
      h('div.row', h('span.badge', { class: kind }, label))),
    h('div.pay-sum',
      h('div.pay-cell', h('span', 'عدد المستحقين'), h('b', String(sheet.length))),
      h('div.pay-cell', h('span', 'إجمالي الشهر'), h('b', money(total) + ' ر.س')),
      h('div.pay-cell', { class: unverified ? 'warn' : '' },
        h('span', 'حسابات غير معتمدة'), h('b', String(unverified)))),
    unverified > 0 ? h('p.small.bad', 'فيه مستحقون لم يُعتمد حسابهم البنكي بعد مطابقته بخطاب البنك، فلا يُصرف لهم قبل الاعتماد.') : null,
    actions,
    sheet.length
      ? h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', head.map(t => h('th', t)))),
          h('tbody', rows),
          h('tfoot', h('tr', h('th', { colspan: '8' }, 'الإجمالي العام'), h('th', money(total)), h('th', { colspan: draft ? '2' : '1' }, '')))))
      : h('div.empty', h('b', 'لا بنود في هذه الدورة'), h('span', 'اضبط أجور الأعضاء في تبويب «أجور الأعضاء» ثم أعد الاحتساب.')));
}
