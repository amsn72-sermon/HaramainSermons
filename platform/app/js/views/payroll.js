// الرواتب والمستحقات: أجر كل عضو، وتسعيرة الأعمال بالمقطوع حسب نوعها،
// ودورة شهرية تُحتسب من الأعمال المنجزة، يعتمدها مدير المشروع ثم تُصرف
// (ملاحظتا ١١٦ و١١٨)
import { h, toast, busy, confirm, dialog, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { isManager, ROLE_LABEL, langName } from '../store.js';
import { PAY_TYPE, PAYROLL_STATUS, WORK_KIND, WORK_KINDS, RATE_BASIS, kindName, basisName, money, monthLabel, monthStart, thisMonth, today } from '../pay.js';
import { exportExcel, exportPdf, exportWord } from '../teamexport.js';

const groupOf = m => (['manager', 'coordinator'].includes(m.role) ? 'إداري'
  : m.track === 'field' ? 'مرشد مكاني' : 'مترجم متخصص');

const num = v => Number(v || 0);

export async function render(ctx) {
  const TABS = [
    ['cycle', 'الدورة الشهرية'],
    ['rates', 'أجور الأعضاء'],
    ['prices', 'تسعيرة الأعمال'],
    ['report', 'تقرير الإنجاز']
  ];
  const want = TABS.some(t => t[0] === ctx.query?.get('tab')) ? ctx.query.get('tab') : 'cycle';

  const [members, pays, cycles, prices, overrides, langRows] = await Promise.all([
    db.select('profiles', { select: 'id,full_name,member_no,role,track,status', status: 'eq.active', order: 'full_name.asc' }),
    db.select('member_pay', { select: '*' }).catch(() => []),
    db.select('payrolls', { select: '*', order: 'period.desc' }).catch(() => []),
    db.select('pay_rates', { select: '*' }).catch(() => []),
    db.select('member_pay_rates', { select: '*' }).catch(() => []),
    db.select('member_languages', { select: 'member_id,language_code' }).catch(() => [])
  ]);
  const langsOf = new Map();
  for (const r of langRows) langsOf.set(r.member_id, [...(langsOf.get(r.member_id) || []), r.language_code]);
  const payOf = new Map(pays.map(p => [p.member_id, p]));
  const priceOf = new Map(prices.map(p => [p.work_kind, { amount: num(p.amount), basis: p.basis || 'work' }]));
  const overOf = new Map(overrides.map(r => [`${r.member_id}|${r.work_kind}`, { amount: num(r.amount), basis: r.basis || 'work' }]));

  const panel = h('div.staff-panel');
  const btns = TABS.map(([key, label]) => {
    const b = h('button.btn.tab', { type: 'button', role: 'tab' }, label);
    b.onclick = () => show(key);
    return b;
  });

  async function show(key) {
    btns.forEach((b, i) => {
      const on = TABS[i][0] === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    history.replaceState(null, '', key === 'cycle' ? '/app/payroll' : `/app/payroll?tab=${key}`);
    panel.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    try {
      panel.replaceChildren(
        key === 'rates' ? ratesSection(members, payOf, priceOf, overOf, langsOf)
        : key === 'prices' ? pricesSection(priceOf)
        : key === 'report' ? await reportSection(payOf)
        : await cycleSection(cycles, members));
    } catch (err) { panel.replaceChildren(h('p.small.bad', err.message)); }
  }

  const view = h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', 'الرواتب والمستحقات'),
      h('p.muted', 'المرشدون المكانيون بأجر شهري، والمترجمون المتخصصون بين شهري ومقطوع. والمقطوع بحسب نوع العمل: خطبة مع تسجيل صوتي، أو خطبة كتابية، أو كتاب، أو مطوية… ولا يُحتسب عمل إلا بإتمامه.'))),
    h('div.tabs', { role: 'tablist' }, btns),
    panel);
  await show(want);
  return view;
}

// ---------------------------------------------------------------------
// تسعيرة الأعمال العامة
// ---------------------------------------------------------------------
function pricesSection(priceOf) {
  const mine = isManager();
  const rows = WORK_KINDS.map(k => {
    const cur = priceOf.get(k) || { amount: 0, basis: 'work' };
    const basis = h('select', { 'aria-label': `أساس احتساب ${kindName(k)}`, disabled: !mine },
      Object.entries(RATE_BASIS).map(([v, l]) => h('option', { value: v }, l)));
    basis.value = cur.basis || 'work';
    const input = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !mine,
      'aria-label': `سعر ${kindName(k)}`, value: cur.amount || '' });
    const hint = h('span.small.muted');
    const paint = () => {
      hint.textContent = basis.value === 'word' ? 'المبلغ عن كل كلمة مترجَمة'
        : basis.value === 'minute' ? 'المبلغ عن كل دقيقة من التسجيل الصوتي'
        : 'مبلغ مقطوع للعمل كله';
    };
    basis.addEventListener('change', paint);
    paint();

    const save = h('button.btn.sm.primary', { type: 'button' }, 'حفظ');
    save.onclick = () => busy(save, async () => {
      await db.rpc('set_pay_rate', { p_kind: k, p_amount: Number(input.value || 0), p_basis: basis.value });
      priceOf.set(k, { amount: Number(input.value || 0), basis: basis.value });
      toast('حُفظ سعر ' + kindName(k), 'ok');
    });
    return h('tr',
      h('td', { 'data-label': 'نوع العمل' }, h('b', kindName(k))),
      h('td', { 'data-label': 'أساس الاحتساب' }, basis, h('div', hint)),
      h('td', { 'data-label': 'المبلغ' }, input),
      h('td', { 'data-label': '' }, mine ? save : h('span.small.muted', 'للمدير')));
  });

  return h('div.stack',
    h('div.card.stack',
      h('h3', 'تسعيرة الأعمال بالمقطوع'),
      h('p.small.muted', 'لكل نوع عمل أساسه ومبلغه: مقطوع للعمل كله، أو بعدد كلماته، أو بدقائق تسجيله. ويسري على كل من أجره بالمقطوع، ويُخصَّص لعضو بعينه من تبويب «أجور الأعضاء».'),
      h('p.small.muted', 'وأنواع الأعمال هي أنواع المواد نفسها في الإسناد: الخطبة كتابيةً أو مع تسجيل، والدرس العلمي كذلك، والكتاب والمطوية والمنشور والإعلان والتوجيه.'),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['نوع العمل', 'أساس الاحتساب', 'المبلغ', ''].map(t => h('th', t)))),
        h('tbody', rows)))));
}

// ---------------------------------------------------------------------
// أجور الأعضاء
// ---------------------------------------------------------------------
function ratesSection(members, payOf, priceOf, overOf, langsOf) {
  const mine = isManager();
  const rows = members.map(m => {
    const p = payOf.get(m.id) || { pay_type: 'none', monthly: 0, per_work: 0, note: '' };
    const type = h('select', { 'aria-label': `نوع أجر ${m.full_name}`, disabled: !mine },
      Object.entries(PAY_TYPE).map(([v, l]) => h('option', { value: v }, l)));
    type.value = p.pay_type || 'none';
    const monthly = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !mine,
      'aria-label': `الأجر الشهري لـ${m.full_name}`, value: num(p.monthly) || '' });
    const note = h('input', { maxlength: 200, disabled: !mine, 'aria-label': `ملاحظة أجر ${m.full_name}`, value: p.note || '' });

    const overCount = () => WORK_KINDS.filter(k => overOf.has(`${m.id}|${k}`)).length;
    const priceBtn = h('button.btn.sm', { type: 'button' });
    const paintBtn = () => {
      const n = overCount();
      priceBtn.replaceChildren(h('span', 'تسعيرة خاصة'));
      if (n) priceBtn.append(h('span.nav-badge', String(n)));
      priceBtn.title = n ? `لهذا العضو ${n} سعرًا خاصًّا` : 'يأخذ التسعيرة العامة';
    };
    priceBtn.onclick = () => memberPrices(m, priceOf, overOf, paintBtn);
    paintBtn();

    const sync = () => {
      monthly.disabled = !mine || type.value !== 'monthly';
      priceBtn.disabled = type.value !== 'per_work';
    };
    type.addEventListener('change', sync);
    sync();

    const save = h('button.btn.sm.primary', { type: 'button' }, 'حفظ');
    save.onclick = () => busy(save, async () => {
      await db.rpc('set_member_pay', {
        p_member: m.id, p_type: type.value,
        p_monthly: type.value === 'monthly' ? Number(monthly.value || 0) : 0,
        p_per_work: 0,
        p_note: note.value || null
      });
      payOf.set(m.id, { member_id: m.id, pay_type: type.value, monthly: monthly.value, per_work: 0, note: note.value });
      toast('حُفظ أجر ' + m.full_name, 'ok');
    });

    const langs = (langsOf?.get(m.id) || []).map(langName);
    return h('tr',
      h('td', { 'data-label': 'العضو' }, h('b', m.full_name), h('div.small.muted', m.member_no || '—')),
      h('td', { 'data-label': 'الفريق' }, groupOf(m), h('div.small.muted', ROLE_LABEL[m.role])),
      h('td', { 'data-label': 'اللغة' }, langs.length ? langs.join('، ') : '—'),
      h('td', { 'data-label': 'نوع الأجر' }, type),
      h('td', { 'data-label': 'الشهري' }, monthly),
      h('td', { 'data-label': 'المقطوع' }, priceBtn),
      h('td', { 'data-label': 'ملاحظة' }, note),
      h('td', { 'data-label': '' }, mine ? save : h('span.small.muted', 'للمدير')));
  });

  const sheet = () => [
    ['العضو', 'الرقم', 'الفريق', 'اللغات', 'نوع الأجر', 'الأجر الشهري', 'تسعيرة خاصة', 'ملاحظة'],
    ...members.map(m => {
      const p = payOf.get(m.id) || {};
      const n = WORK_KINDS.filter(k => overOf.has(`${m.id}|${k}`)).length;
      return [m.full_name, m.member_no || '', groupOf(m),
        (langsOf?.get(m.id) || []).map(langName).join('، '),
        PAY_TYPE[p.pay_type || 'none'], p.pay_type === 'monthly' ? money(p.monthly) : '',
        n ? `${n} نوعًا` : 'التسعيرة العامة', p.note || ''];
    })
  ];
  const title = 'أجور أعضاء الفريق';
  const note = `عدد الأعضاء: ${members.length} — ${fmtDate(new Date())}`;
  const wordBtn = h('button.btn.sm', { type: 'button' }, 'تصدير Word');
  wordBtn.onclick = () => busy(wordBtn, () => exportWord(sheet(), title, { note }).catch(e => toast(e.message, 'bad')));

  return h('div.stack',
    h('p.small.muted', mine
      ? 'الشهري ثابت لا يتأثر بعدد الأعمال. والمقطوع يُحتسب من تسعيرة الأعمال بحسب نوع كل عمل أنجزه العضو في الشهر.'
      : 'ضبط الأجور لمدير المشروع وحده، وهي معروضة لك للاطّلاع وإعداد الكشوف.'),
    h('div.row.wrap',
      h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheet(), title) }, 'تصدير Excel'),
      wordBtn,
      h('button.btn.sm', { type: 'button',
        onclick: () => { if (!exportPdf(sheet(), title, { note })) toast('اسمح بالنوافذ المنبثقة للتصدير', 'bad'); } },
        'تصدير PDF')),
    h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'الفريق', 'اللغة', 'نوع الأجر', 'الشهري', 'المقطوع', 'ملاحظة', ''].map(t => h('th', t)))),
      h('tbody', rows))));
}

// تسعيرة خاصة بعضو: الفارغ يعني «يأخذ التسعيرة العامة»
async function memberPrices(m, priceOf, overOf, onDone) {
  const mine = isManager();
  const fields = new Map();
  const body = h('div.stack',
    h('p.small.muted', 'اترك المبلغ فارغًا ليأخذ العضو السعر العام. والمكتوب هنا يخصّه وحده، بأساسه.'),
    h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['نوع العمل', 'السعر العام', 'أساس خاص', 'مبلغ خاص'].map(t => h('th', t)))),
      h('tbody', WORK_KINDS.map(k => {
        const gen = priceOf.get(k) || { amount: 0, basis: 'work' };
        const cur = overOf.get(`${m.id}|${k}`);
        const basis = h('select', { 'aria-label': `أساس ${kindName(k)} الخاص`, disabled: !mine },
          Object.entries(RATE_BASIS).map(([v, l]) => h('option', { value: v }, l)));
        basis.value = (cur && cur.basis) || gen.basis || 'work';
        const input = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !mine,
          'aria-label': `سعر ${kindName(k)} الخاص`, value: cur ? cur.amount : '' });
        fields.set(k, { basis, input });
        return h('tr',
          h('td', { 'data-label': 'نوع العمل' }, kindName(k)),
          h('td', { 'data-label': 'السعر العام' }, money(gen.amount), h('div.small.muted', basisName(gen.basis))),
          h('td', { 'data-label': 'أساس خاص' }, basis),
          h('td', { 'data-label': 'مبلغ خاص' }, input));
      })))));

  const ok = await dialog({
    title: `تسعيرة ${m.full_name}`,
    body,
    buttons: mine
      ? [{ label: 'حفظ', kind: 'primary', value: true }, { label: 'إلغاء', value: false }]
      : [{ label: 'إغلاق', value: false }]
  });
  if (!ok) return;

  try {
    for (const k of WORK_KINDS) {
      const { basis, input } = fields.get(k);
      const raw = input.value.trim();
      const key = `${m.id}|${k}`;
      const had = overOf.get(key);
      if (raw === '') {
        if (had) { await db.rpc('set_member_rate', { p_member: m.id, p_kind: k, p_amount: null }); overOf.delete(key); }
      } else if (!had || had.amount !== Number(raw) || had.basis !== basis.value) {
        await db.rpc('set_member_rate', { p_member: m.id, p_kind: k, p_amount: Number(raw), p_basis: basis.value });
        overOf.set(key, { amount: Number(raw), basis: basis.value });
      }
    }
    toast('حُفظت تسعيرة ' + m.full_name, 'ok');
    onDone && onDone();
  } catch (err) { toast(err.message, 'bad'); }
}

// ---------------------------------------------------------------------
// تقرير الإنجاز: شهري أو سنوي أو مدة محدَّدة، لعضو أو للفريق كله (ملاحظة ١٢٦)
// ---------------------------------------------------------------------
async function reportSection(payOf) {
  const box = h('div.stack');
  const body = h('div.stack');

  const mode = h('select', { 'aria-label': 'نوع المدة' },
    h('option', { value: 'month' }, 'شهر'),
    h('option', { value: 'year' }, 'سنة'),
    h('option', { value: 'range' }, 'مدة محدَّدة'));
  const month = h('input', { type: 'month', value: thisMonth(), 'aria-label': 'الشهر' });
  const year = h('input', { type: 'number', min: '2020', max: '2100', step: '1', dir: 'ltr',
    value: today().slice(0, 4), 'aria-label': 'السنة' });
  const from = h('input', { type: 'date', value: today().slice(0, 8) + '01', 'aria-label': 'من تاريخ' });
  const to = h('input', { type: 'date', value: today(), 'aria-label': 'إلى تاريخ' });
  const search = h('input', { type: 'search', placeholder: 'اسم العضو أو رقمه', 'aria-label': 'بحث عن عضو' });
  const view = h('select', { 'aria-label': 'شكل التقرير' },
    h('option', { value: 'cards' }, 'بطاقة لكل عضو'),
    h('option', { value: 'matrix' }, 'كشف الفريق في جدول واحد'));

  const monthBox = h('label.field', 'الشهر', month);
  const yearBox = h('label.field', 'السنة', year);
  const rangeBox = h('div.row.wrap', h('label.field', 'من', from), h('label.field', 'إلى', to));
  const syncMode = () => {
    monthBox.hidden = mode.value !== 'month';
    yearBox.hidden = mode.value !== 'year';
    rangeBox.hidden = mode.value !== 'range';
  };
  mode.onchange = () => { syncMode(); load(); };
  syncMode();

  const lastDay = (y, m) => {
    const d = new Date(y, m, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const period = () => {
    if (mode.value === 'year') {
      const y = Number(year.value) || Number(today().slice(0, 4));
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `سنة ${y}` };
    }
    if (mode.value === 'range') {
      return { from: from.value, to: to.value, label: `${fmtDate(from.value)} — ${fmtDate(to.value)}` };
    }
    const [y, m] = (month.value || thisMonth()).split('-').map(Number);
    return { from: `${month.value}-01`, to: lastDay(y, m), label: monthLabel(`${month.value}-01`) };
  };

  month.onchange = () => load();
  year.onchange = () => load();
  from.onchange = () => load();
  to.onchange = () => load();
  view.onchange = () => load();
  search.oninput = () => load();

  async function load() {
    body.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    const p = period();
    if (!p.from || !p.to || p.from > p.to) {
      body.replaceChildren(h('p.small.bad', 'المدة غير صحيحة: تاريخ البداية بعد النهاية.'));
      return;
    }
    const rows = await db.rpc('member_work_report', { p_from: p.from, p_to: p.to }).catch(() => []);
    let list = Array.isArray(rows) ? rows : [];
    const q = search.value.trim();
    if (q) list = list.filter(r => (r.full_name || '').includes(q) || String(r.member_no || '').includes(q));

    if (!list.length) {
      body.replaceChildren(h('div.empty', h('b', 'لا أعمال مكتملة في هذه المدة'),
        h('span', q ? 'جرّب اسمًا آخر أو امسح البحث.' : 'يُحتسب العمل عند إتمام مساره واكتماله، لا عند إسناده.')));
      return;
    }

    const byMember = new Map();
    for (const r of list) {
      if (!byMember.has(r.member_id)) {
        byMember.set(r.member_id, { name: r.full_name, no: r.member_no, pay: r.pay_type, kinds: [] });
      }
      byMember.get(r.member_id).kinds.push(r);
    }
    const monthlyOf = id => num((payOf.get(id) || {}).monthly);
    const memberTotal = (id, m) => (m.pay === 'monthly' ? monthlyOf(id) : m.kinds.reduce((s, r) => s + num(r.amount), 0));

    body.replaceChildren(
      h('div.row.wrap', ...exportButtons(p, list, byMember, monthlyOf, memberTotal)),
      view.value === 'matrix'
        ? matrixTable(p, byMember, monthlyOf, memberTotal)
        : h('div.stack', ...[...byMember.entries()].map(([id, m]) => memberCard(id, m, p, memberTotal(id, m)))));
  }

  // ---------- بطاقة العضو ----------
  function memberCard(id, m, p, total) {
    const works = m.kinds.reduce((s, r) => s + num(r.works), 0);
    const detail = h('button.btn.sm', { type: 'button' }, 'تفصيل الأعمال');
    detail.onclick = () => busy(detail, () => worksDialog(id, m, p.from, p.to, p.label));
    return h('div.card.stack',
      h('div.row.between.wrap',
        h('div', h('h3', m.name), h('div.small.muted', [m.no, PAY_TYPE[m.pay] || ''].filter(Boolean).join(' · '))),
        h('div.row',
          h('span.badge', `${works} عملًا`),
          h('span.badge.gold', money(total) + ' ر.س'),
          detail)),
      m.pay === 'monthly'
        ? h('p.small.muted', 'أجره شهري ثابت يشمل أعماله كلها، والأعمال هنا للعلم لا للاحتساب.') : null,
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['نوع العمل', 'العدد', 'الكلمات', 'دقائق التسجيل', 'السعر وأساسه', 'المبلغ'].map(t => h('th', t)))),
        h('tbody', m.kinds.map(r => h('tr',
          h('td', { 'data-label': 'نوع العمل' }, kindName(r.work_kind)),
          h('td', { 'data-label': 'العدد' }, h('b', String(r.works))),
          h('td', { 'data-label': 'الكلمات' }, num(r.words).toLocaleString('en-US')),
          h('td', { 'data-label': 'الدقائق' }, String(num(r.minutes))),
          h('td', { 'data-label': 'السعر' }, m.pay === 'per_work'
            ? h('span', money(r.rate), h('div.small.muted', basisName(r.basis))) : '—'),
          h('td', { 'data-label': 'المبلغ' }, m.pay === 'per_work' ? money(r.amount) : '—')))))));
  }

  // ---------- كشف الفريق: صفوف الأعضاء وأعمدة الأعمال ----------
  function usedKinds(byMember) {
    const set = new Set();
    for (const m of byMember.values()) for (const r of m.kinds) if (num(r.works) > 0) set.add(r.work_kind);
    return WORK_KINDS.filter(k => set.has(k));
  }
  function cellOf(m, kind) {
    const r = m.kinds.find(x => x.work_kind === kind);
    if (!r || !num(r.works)) return null;
    return r;
  }
  function matrixTable(p, byMember, monthlyOf, memberTotal) {
    const kinds = usedKinds(byMember);
    const entries = [...byMember.entries()];
    const grand = entries.reduce((s, [id, m]) => s + memberTotal(id, m), 0);
    return h('div.card.stack',
      h('h3', `كشف إنجاز الفريق — ${p.label}`),
      h('p.small.muted', 'في كل خانة عدد الأعمال ومبلغها. ومن أجره شهري يُوضع مبلغه الثابت شاملًا أعماله كلها.'),
      h('div.table-wrap', h('table.responsive.matrix',
        h('thead', h('tr', h('th', 'العضو'), kinds.map(k => h('th', kindName(k))), h('th', 'الإجمالي'))),
        h('tbody', entries.map(([id, m]) => h('tr',
          h('td', { 'data-label': 'العضو' }, h('b', m.name),
            h('div.small.muted', [m.no, PAY_TYPE[m.pay]].filter(Boolean).join(' · '))),
          kinds.map(k => {
            const r = cellOf(m, k);
            return h('td', { 'data-label': kindName(k) }, r
              ? h('span', h('b', `${r.works}`), h('div.small.muted',
                  m.pay === 'per_work' ? money(r.amount) : 'ضمن الشهري'))
              : '—');
          }),
          h('td', { 'data-label': 'الإجمالي' },
            h('b', money(memberTotal(id, m))),
            m.pay === 'monthly' ? h('div.small.muted', 'أجر شهري') : null)))),
        h('tfoot', h('tr', h('th', 'الإجمالي العام'),
          kinds.map(k => h('th', String(entries.reduce((s, [, m]) => s + num((cellOf(m, k) || {}).works), 0)))),
          h('th', money(grand)))))));
  }

  // ---------- التصدير ----------
  function exportButtons(p, list, byMember, monthlyOf, memberTotal) {
    const kinds = usedKinds(byMember);
    const entries = [...byMember.entries()];
    const grand = entries.reduce((s, [id, m]) => s + memberTotal(id, m), 0);

    const detailRows = () => [
      ['العضو', 'الرقم', 'نوع الأجر', 'نوع العمل', 'العدد', 'الكلمات', 'دقائق التسجيل', 'الأساس', 'السعر', 'المبلغ'],
      ...list.map(r => [r.full_name, r.member_no || '', PAY_TYPE[r.pay_type] || r.pay_type,
        kindName(r.work_kind), String(r.works), String(num(r.words)), String(num(r.minutes)),
        basisName(r.basis), money(r.rate), r.pay_type === 'per_work' ? money(r.amount) : 'ضمن الشهري']),
      ['الإجمالي', '', '', '', String(list.reduce((s, r) => s + num(r.works), 0)),
        String(list.reduce((s, r) => s + num(r.words), 0)),
        String(list.reduce((s, r) => s + num(r.minutes), 0)), '', '', money(grand)]
    ];
    const matrixRows = () => [
      ['العضو', 'الرقم', 'نوع الأجر', ...kinds.map(kindName), 'الإجمالي'],
      ...entries.map(([id, m]) => [m.name, m.no || '', PAY_TYPE[m.pay] || '',
        ...kinds.map(k => {
          const r = cellOf(m, k);
          return r ? (m.pay === 'per_work' ? `${r.works} × ${money(r.amount)}` : String(r.works)) : '';
        }),
        money(memberTotal(id, m))]),
      ['الإجمالي العام', '', '', ...kinds.map(k =>
        String(entries.reduce((s, [, m]) => s + num((cellOf(m, k) || {}).works), 0))), money(grand)]
    ];
    const rowsOf = () => (view.value === 'matrix' ? matrixRows() : detailRows());
    const title = `تقرير الإنجاز — ${p.label}`;
    const note = `عدد الأعضاء: ${entries.length} — الإجمالي: ${money(grand)} ر.س — ${fmtDate(new Date())}`;

    const wordBtn = h('button.btn.sm', { type: 'button' }, 'تصدير Word');
    wordBtn.onclick = () => busy(wordBtn, () => exportWord(rowsOf(), title, { note }).catch(e => toast(e.message, 'bad')));
    return [
      h('button.btn.sm', { type: 'button', onclick: () => exportExcel(rowsOf(), title) }, 'تصدير Excel'),
      wordBtn,
      h('button.btn.sm', { type: 'button',
        onclick: () => { if (!exportPdf(rowsOf(), title, { note })) toast('اسمح بالنوافذ المنبثقة للتصدير', 'bad'); } },
        'تصدير PDF')
    ];
  }

  box.append(
    h('div.card.stack',
      h('div.row.wrap',
        h('label.field', 'المدة', mode), monthBox, yearBox, rangeBox,
        h('label.field', 'بحث', search),
        h('label.field', 'العرض', view)),
      h('p.small.muted', 'ما أنجزه كل عضو في المدة بأنواعه: خطبة مع تسجيل، خطبة كتابية، كتاب، مطوية… ومبلغ كل نوع لمن أجره بالمقطوع. ومن أجره شهري يظهر مبلغه الثابت.')),
    body);
  await load();
  return box;
}

// أعمال العضو عملًا عملًا ببياناتها: الكلمات والصفحات ودقائق التسجيل (ملاحظة ١٢١)
async function worksDialog(memberId, m, from, to, label) {
  let rows = [];
  try { rows = await db.rpc('member_work_list', { p_member: memberId, p_from: from, p_to: to }); }
  catch (err) { return toast(err.message, 'bad'); }
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return toast('لا أعمال مكتملة لهذا العضو في المدة', 'bad');

  const minutes = sec => Math.round(num(sec) / 60);
  const sum = k => list.reduce((s, r) => s + num(r[k]), 0);
  const totalAmount = m.pay === 'per_work' ? list.reduce((s, r) => s + num(r.amount), 0) : 0;

  const sheetRows = () => [
    ['نوع العمل', 'العنوان', 'اللغة', 'المرحلة التي أنجزها', 'تاريخ الاكتمال', 'الكلمات', 'الصفحات', 'دقائق التسجيل', 'المبلغ'],
    ...list.map(r => [kindName(r.work_kind), r.title, langName(r.language_code), r.stages || '—',
      fmtDate(r.completed_at), String(r.words || 0), String(r.pages || 0), String(minutes(r.audio_seconds)),
      m.pay === 'per_work' ? money(r.amount) : '']),
    ['الإجمالي', `${list.length} عملًا`, '', '', '', String(sum('words')), String(sum('pages')),
      String(Math.round(sum('audio_seconds') / 60)), m.pay === 'per_work' ? money(totalAmount) : '']
  ];
  const title = `أعمال ${m.name} — ${label || monthLabel(from)}`;

  const v = await dialog({
    title,
    body: h('div.stack',
      h('div.pay-sum',
        h('div.pay-cell', h('span', 'عدد الأعمال'), h('b', String(list.length))),
        h('div.pay-cell', h('span', 'مجموع الكلمات'), h('b', sum('words').toLocaleString('en-US'))),
        h('div.pay-cell', h('span', 'دقائق التسجيل'), h('b', String(Math.round(sum('audio_seconds') / 60))))),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['نوع العمل', 'العنوان', 'اللغة', 'المرحلة', 'الاكتمال', 'الكلمات', 'الصفحات', 'دقائق', 'المبلغ'].map(t => h('th', t)))),
        h('tbody', list.map(r => h('tr',
          h('td', { 'data-label': 'نوع العمل' }, kindName(r.work_kind)),
          h('td', { 'data-label': 'العنوان' }, h('b', r.title), r.sermon_type ? h('div.small.muted', r.sermon_type) : null),
          h('td', { 'data-label': 'اللغة' }, langName(r.language_code)),
          h('td', { 'data-label': 'المرحلة' }, r.stages || '—'),
          h('td', { 'data-label': 'الاكتمال' }, fmtDate(r.completed_at)),
          h('td', { 'data-label': 'الكلمات' }, String(r.words || 0)),
          h('td', { 'data-label': 'الصفحات' }, String(r.pages || 0)),
          h('td', { 'data-label': 'دقائق' }, String(minutes(r.audio_seconds))),
          h('td', { 'data-label': 'المبلغ' }, m.pay === 'per_work'
            ? h('span', money(r.amount), h('div.small.muted', basisName(r.basis))) : '—')))),
        h('tfoot', h('tr',
          h('th', 'الإجمالي'), h('th', `${list.length} عملًا`), h('th', ''), h('th', ''), h('th', ''),
          h('th', String(sum('words'))), h('th', String(sum('pages'))),
          h('th', String(Math.round(sum('audio_seconds') / 60))),
          h('th', m.pay === 'per_work' ? money(totalAmount) : '—')))))),
    buttons: [
      { label: 'تصدير PDF', value: 'pdf' },
      { label: 'تصدير Excel', value: 'excel' },
      { label: 'تصدير Word', value: 'word' },
      { label: 'إغلاق', value: null }
    ]
  });
  if (!v) return;
  const note = `${list.length} عملًا — ${fmtDate(new Date())}`;
  if (v === 'excel') return exportExcel(sheetRows(), title);
  if (v === 'word') return exportWord(sheetRows(), title, { note }).catch(e => toast(e.message, 'bad'));
  if (!exportPdf(sheetRows(), title, { note })) toast('اسمح بالنوافذ المنبثقة لتصدير الكشف', 'bad');
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

  const pick = h('select', { 'aria-label': 'دورة محفوظة' },
    h('option', { value: '' }, 'الدورات المحفوظة'),
    cycles.map(c => h('option', { value: String(c.period).slice(0, 7) }, monthLabel(c.period))));
  pick.onchange = () => { if (pick.value) { month.value = pick.value; open(pick.value); } };

  build.onclick = () => busy(build, async () => {
    const period = monthStart(month.value);
    if (!period) return toast('اختر الشهر أولًا', 'bad');
    await db.rpc('build_payroll', { p_period: period });
    toast('احتُسبت دورة ' + monthLabel(period), 'ok');
    await open(month.value);
  });

  async function open(m) {
    body.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    const period = monthStart(m);
    const [rowCycle] = await db.select('payrolls', { select: '*', period: `eq.${period}` }).catch(() => []);
    if (!rowCycle) {
      body.replaceChildren(h('div.empty', h('b', 'لا دورة لهذا الشهر بعد'),
        h('span', 'اضغط «احتساب الدورة» لبناء بنودها من أجور الأعضاء وأعمالهم المنجزة.')));
      return;
    }
    const [sheet, kinds] = await Promise.all([
      db.select('payroll_sheet', { select: '*', payroll_id: `eq.${rowCycle.id}`, order: 'full_name.asc' }),
      db.rpc('payroll_kinds', { p_payroll: rowCycle.id }).catch(() => [])
    ]);
    body.replaceChildren(cycleCard(rowCycle, sheet, Array.isArray(kinds) ? kinds : [], () => open(m), members));
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

function cycleCard(cycle, sheet, kinds, reload, members) {
  const [label, kind] = PAYROLL_STATUS[cycle.status] || [cycle.status, ''];
  const draft = cycle.status === 'draft';
  const mgr = isManager();
  const total = sheet.reduce((s, r) => s + num(r.total), 0);
  const unverified = sheet.filter(r => num(r.total) > 0 && !r.bank_verified).length;
  const byId = new Map(members.map(m => [m.id, m]));

  const kindsOf = id => kinds.filter(k => k.member_id === id && num(k.works) > 0);
  const kindsText = id => kindsOf(id).map(k => `${kindName(k.work_kind)} ×${k.works}`).join(' · ');

  const rows = sheet.map((r, i) => {
    const allowance = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !draft,
      'aria-label': `بدل ${r.full_name}`, value: num(r.allowance) || '' });
    const deduction = h('input', { type: 'number', min: '0', step: '0.01', dir: 'ltr', disabled: !draft,
      'aria-label': `خصم ${r.full_name}`, value: num(r.deduction) || '' });
    const note = h('input', { maxlength: 200, disabled: !draft, 'aria-label': `سبب البدل أو الخصم لـ${r.full_name}`, value: r.note || '' });
    const totalCell = h('b', money(r.total));
    const paint = () => { totalCell.textContent = money(num(r.base) + num(allowance.value) - num(deduction.value)); };
    allowance.addEventListener('input', paint);
    deduction.addEventListener('input', paint);

    const save = h('button.btn.sm', { type: 'button' }, 'حفظ');
    save.onclick = () => busy(save, async () => {
      if ((num(deduction.value) > 0 || num(allowance.value) > 0) && !note.value.trim()) {
        return toast('اكتب سبب البدل أو الخصم', 'bad');
      }
      await db.rpc('set_payroll_item', { p_payroll: cycle.id, p_member: r.member_id,
        p_allowance: Number(allowance.value || 0), p_deduction: Number(deduction.value || 0), p_note: note.value || null });
      toast('حُفظ بند ' + r.full_name, 'ok');
    });

    const detail = kindsOf(r.member_id);
    const works = h('td', { 'data-label': 'الأعمال' });
    if (r.pay_type === 'per_work' && detail.length) {
      const btn = h('button.btn.xs.ghost', { type: 'button', title: 'تفصيل الأعمال المحتسبة' },
        `${r.works || 0} عملًا`);
      btn.onclick = () => dialog({
        title: `أعمال ${r.full_name} — ${monthLabel(cycle.period)}`,
        body: h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['نوع العمل', 'العدد', 'الكلمات', 'الدقائق', 'السعر وأساسه', 'المبلغ'].map(t => h('th', t)))),
          h('tbody', detail.map(k => h('tr',
            h('td', { 'data-label': 'نوع العمل' }, kindName(k.work_kind)),
            h('td', { 'data-label': 'العدد' }, String(k.works)),
            h('td', { 'data-label': 'الكلمات' }, num(k.words).toLocaleString('en-US')),
            h('td', { 'data-label': 'الدقائق' }, String(num(k.minutes))),
            h('td', { 'data-label': 'السعر' }, money(k.rate), h('div.small.muted', basisName(k.basis))),
            h('td', { 'data-label': 'المبلغ' }, money(k.amount))))),
          h('tfoot', h('tr', h('th', 'المجموع'), h('th', String(detail.reduce((s, k) => s + num(k.works), 0))),
            h('th', String(detail.reduce((s, k) => s + num(k.words), 0))),
            h('th', String(detail.reduce((s, k) => s + num(k.minutes), 0))),
            h('th', ''), h('th', money(detail.reduce((s, k) => s + num(k.amount), 0)))))))
      });
      works.append(btn, h('div.small.muted', kindsText(r.member_id)));
    } else works.append(r.pay_type === 'per_work' ? '0' : '—');

    const m = byId.get(r.member_id);
    return h('tr',
      h('td.n', { 'data-label': 'م' }, String(i + 1)),
      h('td', { 'data-label': 'العضو' }, h('b', r.full_name),
        h('div.small.muted', [m ? groupOf(m) : null, r.member_no].filter(Boolean).join(' · ') || '—')),
      h('td', { 'data-label': 'نوع الأجر' }, PAY_TYPE[r.pay_type] || r.pay_type),
      works,
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

  const sheetRows = () => [
    ['العضو', 'الرقم', 'نوع الأجر', 'الأعمال', 'تفصيل الأعمال', 'الأساس', 'بدل', 'خصم', 'الإجمالي',
      'البنك', 'الآيبان', 'حالة الحساب', 'السبب'],
    ...sheet.map(r => [r.full_name, r.member_no || '', PAY_TYPE[r.pay_type] || r.pay_type,
      r.pay_type === 'per_work' ? String(r.works || 0) : '', kindsText(r.member_id),
      money(r.base), money(r.allowance), money(r.deduction), money(r.total),
      r.bank_name || '', r.iban || '', r.iban ? (r.bank_verified ? 'معتمَد' : 'تحت المراجعة') : 'لا حساب', r.note || '']),
    ['الإجمالي العام', '', '', '', '', '', '', '', money(total), '', '', '', '']
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
