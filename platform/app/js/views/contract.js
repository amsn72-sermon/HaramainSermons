// بنود العقد وكمياته، ومسودّة المستخلص الشهري (ملاحظتا ١٤٨ و١٥١)
//   الأسعار مرجعٌ من كراسة المواصفات: تُعرض حين تُطلب، ولا تُطبَّق على أحد،
//   ولا تُحسم غرامة ولا يُربط بها أجر عضو.
import { h, toast, busy, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { isManager } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';
import { pickColumns, narrowSheet } from '../columns.js';
import { icon } from '../icons.js';
import { scopeSection } from './scope.js';
import { opsSection } from '../opsreport.js';
import { penaltySection } from '../penalties.js';

const ar = n => Number(n || 0).toLocaleString('en-US');
const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = n => (Number(n || 0) % 1 === 0 ? ar(n) : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const pct = (a, b) => (Number(b) > 0 ? Math.min(100, (Number(a) / Number(b)) * 100) : 0);

const MONTHS = 24;      // مدة العقد
export const CLAIM_NOTE = 'القيم وفق جدول الكميات والأسعار في العقد، والاعتماد لإدارة الهيئة.';

// شريط تقدّم بند: المنجَز من المتعاقد عليه
function bar(done, total) {
  const p = pct(done, total);
  return h('div.qbar', { role: 'img', 'aria-label': `${Math.round(p)}٪ من الكمية التعاقدية` },
    h('span.qbar-fill', { style: { width: `${p}%` } }));
}

export async function render(ctx) {
  if (!isManager()) {
    return h('div.card.stack', h('h1', 'بنود العقد والمستخلص'),
      h('p.muted', 'هذه الشاشة لمدير المشروع وحده.'));
  }
  const [rows, initRows] = await Promise.all([
    db.rpc('contract_progress').catch(() => []),
    db.rpc('initiative_languages').catch(() => [])
  ]);
  const items = Array.isArray(rows) ? rows : [];
  const inits = Array.isArray(initRows) ? initRows : [];
  const admin = isManager();

  // ---------------- شريط الكميات ----------------
  const started = h('input', { type: 'month', 'aria-label': 'بداية العقد' });
  const savedStart = (() => { try { return localStorage.getItem('hs.contractStart') || ''; } catch { return ''; } })();
  started.value = savedStart;
  const elapsed = h('p.small.muted');
  const paintElapsed = () => {
    if (!started.value) { elapsed.textContent = 'حدّد شهر بداية العقد لتُقارن نسبة المنجَز بنسبة مضيّ المدة.'; return; }
    const from = new Date(started.value + '-01T12:00:00');
    const months = Math.max(0, (new Date().getFullYear() - from.getFullYear()) * 12
      + (new Date().getMonth() - from.getMonth()));
    const p = Math.min(100, (months / MONTHS) * 100);
    elapsed.textContent = `مضى من مدة العقد ${ar(months)} شهرًا من ${ar(MONTHS)} — ${p.toFixed(1)}٪.`;
  };
  started.onchange = () => { try { localStorage.setItem('hs.contractStart', started.value); } catch { /* */ } paintElapsed(); };
  paintElapsed();

  const quantities = h('div.stack',
    items.map(it => {
      const done = Number(it.qty_done || 0), total = Number(it.qty_contracted || 0);
      return h('div.card.qitem',
        h('div.row.between',
          h('b', `${it.code}) ${it.name}`),
          h('span.badge', it.unit)),
        total > 0 ? bar(done, total) : null,
        h('div.row.between.small',
          h('span', total > 0 ? `المنجَز ${qty(done)} من ${qty(total)}` : `المنجَز ${qty(done)}`),
          h('span.muted', total > 0 ? `${pct(done, total).toFixed(1)}٪ · المتبقي ${qty(Math.max(0, total - done))}` : 'كميته تُحدَّد إداريًّا')),
        // المتطوَّع به يُعرض ولا يدخل الكمية المحتسَبة (ملاحظة ١٩٤)
        Number(it.qty_initiative) > 0
          ? h('p.small.gold', `وزيادةً ${qty(it.qty_initiative)} من مبادرة المتعاقد — بلا مقابل، `
              + 'فلا تدخل الكمية المحتسَبة.')
          : null,
        it.note ? h('p.small.muted', it.note) : null);
    }));

  // ---------------- مسودّة المستخلص ----------------
  const monthIn = h('input', { type: 'month', value: new Date().toISOString().slice(0, 7), 'aria-label': 'شهر المستخلص' });
  const withPrices = h('input', { type: 'checkbox', id: 'claim-prices' });
  const claimBox = h('div.stack');
  let claim = [];
  let draft = { columns: [], labels: {} };

  const monthOf = () => (monthIn.value || new Date().toISOString().slice(0, 7)) + '-01';

  // اسمُ العمود كما سمّاه مديرُ المشروع، وإلا فاسمُه الأصلي (ملاحظة ٢٤٢)
  const lbl = (key, def) => (draft.labels && draft.labels[key]) || def;

  async function loadClaim() {
    const m = monthOf();
    try {
      const [sheet, d] = await Promise.all([
        db.rpc('claim_sheet', { p_month: m }),
        db.rpc('claim_draft', { p_month: m }).catch(() => null)
      ]);
      claim = Array.isArray(sheet) ? sheet : [];
      const dd = Array.isArray(d) ? d[0] : d;
      draft = dd && typeof dd === 'object'
        ? { columns: dd.columns || [], labels: dd.labels || {} }
        : { columns: [], labels: {} };
    } catch (err) { claim = []; toast(err.message, 'bad'); }
    drawClaim();
  }

  // تعريفُ الأعمدة: القائمةُ ثم ما أضافه مديرُ المشروع
  function claimCols() {
    const show = withPrices.checked;
    const base = [
      { key: 'name',       label: lbl('name', 'البند') },
      { key: 'unit',       label: lbl('unit', 'الوحدة') },
      { key: 'qty_actual', label: lbl('qty_actual', 'الكمية الفعلية') },
      { key: 'qty_claim',  label: lbl('qty_claim', 'الكمية المحتسَبة') },
      { key: 'qty_initiative', label: lbl('qty_initiative', 'مبادرة بلا مقابل') },
      { key: 'reason',     label: lbl('reason', 'سبب الفرق') }
    ];
    if (show) base.push(
      { key: 'unit_price', label: lbl('unit_price', 'سعر الوحدة') },
      { key: 'amount',     label: lbl('amount', 'القيمة') });
    (draft.columns || []).forEach(c => base.push({ key: `x:${c.key}`, label: c.label, extra: true }));
    return base;
  }

  const cellOf = (r, key) => {
    if (key.startsWith('x:')) return (r.extras || {})[key.slice(2)] ?? '';
    switch (key) {
      case 'name': return r.name;
      case 'unit': return r.unit;
      case 'qty_actual': return qty(r.qty_actual);
      case 'qty_claim': return qty(r.qty_claim);
      case 'qty_initiative': return Number(r.qty_initiative) > 0 ? qty(r.qty_initiative) : '—';
      case 'reason': return r.reason || '';
      case 'unit_price': return r.unit_price == null ? '—' : money(r.unit_price);
      case 'amount': return r.unit_price == null ? '—' : money(r.amount);
      default: return '';
    }
  };

  function claimRows(keys) {
    const cols = claimCols();
    const use = (keys && keys.length ? cols.filter(c => keys.includes(c.key)) : cols);
    const head = use.map(c => c.label);
    const body = claim.map(r => use.map(c => cellOf(r, c.key)));
    if (withPrices.checked && use.some(c => c.key === 'amount')) {
      const sum = claim.reduce((s, r) => s + Number(r.amount || 0), 0);
      const row = v => use.map((c, i) => (i === 0 ? v[0] : c.key === 'amount' ? v[1] : ''));
      body.push(row(['الإجمالي قبل الضريبة', money(sum)]));
      body.push(row(['ضريبة القيمة المضافة ١٥٪', money(sum * 0.15)]));
      body.push(row(['الإجمالي المطالَب به', money(sum * 1.15)]));
    }
    return { head, body, cols };
  }

  // تحريرُ صفٍّ: الكميةُ المحتسَبةُ وسببُها وأعمدتُك المضافة (ملاحظة ٢٤٢)
  async function editRow(r) {
    const q = h('input', { type: 'number', min: 0, step: 'any', value: r.qty_claim ?? '',
      'aria-label': 'الكمية المحتسَبة' });
    const why = h('input', { value: r.reason || '', 'aria-label': 'سبب الفرق',
      placeholder: 'إعفاءٌ من الهيئة، تقديرٌ معتمد…' });
    const xs = (draft.columns || []).map(c => ({ key: c.key, label: c.label,
      el: h('input', { value: (r.extras || {})[c.key] ?? '', 'aria-label': c.label }) }));
    const diff = h('p.small.muted');
    const paintDiff = () => {
      const v = q.value === '' ? Number(r.qty_actual) : Number(q.value);
      diff.className = v === Number(r.qty_actual) ? 'small muted' : 'small gold';
      diff.textContent = v === Number(r.qty_actual)
        ? 'مطابقٌ للفعلي.'
        : `يُقدَّم ${qty(v)} والفعليُّ ${qty(r.qty_actual)} — والفرقُ ${qty(Math.abs(v - Number(r.qty_actual)))}.`;
    };
    q.oninput = paintDiff; paintDiff();

    const { dialog } = await import('../ui.js');
    const res = await dialog({
      title: `${r.code}) ${r.name}`,
      body: h('div.stack',
        h('p.small.muted', 'الكميةُ الفعليةُ من المنصة لا تُمسّ، وهي شاهدُ ما أُنجز. '
          + 'والمحتسَبةُ هي التي تُقدَّم إلى الهيئة، وبها تُضرب القيمة.'),
        h('div.grid-2',
          h('div', h('div.small.muted', 'الكمية الفعلية'),
            h('b.kpi-num', qty(r.qty_actual)), h('span.sub', r.unit)),
          h('label.field', 'الكمية المحتسَبة', q,
            h('small', 'اتركه فارغًا ليساوي الفعلي'))),
        diff,
        h('label.field', 'سبب الفرق', why,
          h('small', 'يُحفظ في سجلّ المستخلص ولا يظهر في المطالبة إلا إن صدّرتَ عمودَه')),
        xs.length ? h('fieldset.stack', h('legend', 'الأعمدة المضافة'),
          h('div.grid-2', xs.map(x => h('label.field', x.label, x.el)))) : null),
      buttons: [
        { label: 'حفظ', kind: 'primary', value: () => ({
          month: monthOf(), item_code: r.code,
          qty_claim: q.value === '' ? null : q.value,
          reason: why.value.trim() || null,
          extras: Object.fromEntries(xs.map(x => [x.key, x.el.value.trim()])) }) },
        { label: 'أعِد إلى الفعلي', kind: 'ghost', value: () => 'reset' },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      if (res === 'reset') await db.rpc('reset_claim_row', { p_month: monthOf(), p_code: r.code });
      else await db.rpc('save_claim_row', { p: res });
      toast('حُفظ.', 'ok');
      await loadClaim();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // إضافةُ عمودٍ وتسميةُ الأعمدة (ملاحظة ٢٤٢)
  async function columnsDialog() {
    const { dialog } = await import('../ui.js');
    const cols = (draft.columns || []).map(c => ({ ...c }));
    const box = h('div.stack');
    const drawCols = () => {
      box.replaceChildren(...(cols.length ? cols.map((c, i) => {
        const nm = h('input', { value: c.label, 'aria-label': 'اسم العمود' });
        nm.oninput = () => { cols[i].label = nm.value; };
        const del = h('button.btn.xs.ghost', { type: 'button',
          onclick: () => { cols.splice(i, 1); drawCols(); } }, '✕');
        return h('div.repo-item', nm, del);
      }) : [h('p.small.muted', 'لا أعمدة مضافة.')]));
    };
    drawCols();
    const add = h('button.btn.xs', { type: 'button', onclick: () => {
      cols.push({ key: `c${Date.now().toString(36)}`, label: 'عمود جديد', kind: 'text' });
      drawCols();
    } }, '＋ عمود');

    // تسميةُ الأعمدة القائمة
    const BASE = [['name', 'البند'], ['unit', 'الوحدة'], ['qty_actual', 'الكمية الفعلية'],
      ['qty_claim', 'الكمية المحتسَبة'], ['qty_initiative', 'مبادرة بلا مقابل'],
      ['reason', 'سبب الفرق'], ['unit_price', 'سعر الوحدة'], ['amount', 'القيمة']];
    const names = BASE.map(([k, def]) => ({ k, def,
      el: h('input', { value: (draft.labels || {})[k] || '', placeholder: def,
        'aria-label': `اسم عمود ${def}` }) }));

    const res = await dialog({
      title: 'أعمدة المستخلص',
      body: h('div.stack',
        h('p.small.muted', 'تُضاف أعمدةٌ بأسمائها وتُملأ صفًّا صفًّا، وتُسمّى الأعمدةُ القائمةُ '
          + 'بما يوافق الهيئة. ويُحفظ ذلك لهذا الشهر وحدَه.'),
        h('fieldset.stack', h('legend', 'أعمدة مضافة'), box, h('div.row', add)),
        h('fieldset.stack', h('legend', 'أسماء الأعمدة القائمة'),
          h('div.grid-2', names.map(n => h('label.field', n.def, n.el))))),
      buttons: [
        { label: 'حفظ', kind: 'primary', value: () => ({
          month: monthOf(),
          columns: cols.filter(c => String(c.label || '').trim()),
          labels: Object.fromEntries(names.map(n => [n.k, n.el.value.trim()])
            .filter(([, v]) => v)) }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try { await db.rpc('save_claim_columns', { p: res }); toast('حُفظت الأعمدة.', 'ok'); await loadClaim(); }
    catch (e) { toast(e.message, 'bad'); }
  }

  function drawClaim() {
    const { head, body, cols } = claimRows();
    const n = claim.length;
    const edited = claim.filter(r => r.edited).length;
    claimBox.replaceChildren(
      h('div.row.between',
        h('span.small.muted', edited
          ? `${edited} بندًا قُدِّم بكميةٍ غير الفعلية.`
          : 'المقدَّمُ مطابقٌ لما في المنصة.'),
        h('button.btn.xs', { type: 'button', onclick: () => columnsDialog() }, '⚙ الأعمدة')),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', head.map(t => h('th', t)), h('th', ''))),
        h('tbody', body.length ? body.map((r, i) => {
          const row = claim[i];
          return h('tr', { class: i >= n ? 'total-row' : (row?.edited ? 'row-edited' : '') },
            r.map((v, c) => h('td', { 'data-label': head[c] },
              cols[c]?.key === 'qty_claim' && row?.edited ? h('b.gold', v) : v)),
            h('td', i < n
              ? h('button.btn.xs', { type: 'button', onclick: () => editRow(row) }, 'حرّر')
              : null));
        }) : [h('tr', h('td', { colspan: String(head.length + 1) },
            h('p.muted', 'لا كميات في هذا الشهر.')))]))),
      withPrices.checked
        ? h('p.small.muted', CLAIM_NOTE)
        : h('p.small.muted', 'الكميات وحدها. وبتأشير «إظهار قيم الكراسة» تُطبَّق أسعار العقد فتخرج مسودّة المطالبة.'),
      h('p.small.muted', 'والكميةُ الفعليةُ شاهدُ المنصة لا تُمسّ؛ والمحتسَبةُ هي المقدَّمة، '
        + 'تُحرَّر بسببها ويُحفظ أثرُها.'),
      h('p.small.gold', 'وعمودُ المبادرة بيانٌ لما تطوّع به المتعاقد: لا يُسعَّر ولا يدخل المطالبة.'));
  }

  monthIn.onchange = loadClaim;
  withPrices.onchange = drawClaim;

  const fmtSel = h('select', { 'aria-label': 'صيغة التصدير' },
    h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
    h('option', { value: 'docx' }, 'Word على كليشة الهيئة'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
  const expBtn = h('button.btn.sm.primary', { type: 'button' }, 'تصدير مسودّة المستخلص');
  expBtn.onclick = () => busy(expBtn, async () => {
    // اختيارُ الأعمدة قبل التصدير (ملاحظة ٢٤٠)
    const keys = await pickColumns({
      key: 'claim', title: 'أعمدة مسودّة المستخلص', columns: claimCols(),
      required: ['name'],
      note: 'اختر ما يُقدَّم إلى الهيئة. ولك أن تُخرج «الكمية الفعلية» أو تُخفيها، '
        + 'فالمقدَّمُ هو «المحتسَبة».' });
    if (!keys) return;
    const { head, body } = claimRows(keys);
    const label = `مسودّة المستخلص — ${monthIn.value}`;
    const note = withPrices.checked
      ? `${CLAIM_NOTE} — حُرِّرت في ${fmtDate(new Date())}`
      : `كميات الإنجاز لشهر ${monthIn.value} — ${fmtDate(new Date())}`;
    try {
      if (fmtSel.value === 'xlsx') {
        downloadBlob(buildXlsx([head, ...body], { sheetName: 'المستخلص', allText: true }), `${label}.xlsx`);
      } else {
        const { exportWord, exportPdf } = await import('../teamexport.js');
        if (fmtSel.value === 'docx') await exportWord([head, ...body], label, { note });
        else if (!exportPdf([head, ...body], label, { note })) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  await loadClaim();

  // ---------------- جدول البنود المرجعي ----------------
  const refHead = ['#', 'البند', 'الوحدة', 'سعر الوحدة', 'الكمية التعاقدية', 'قيمة البند'];
  const refTable = h('div.table-wrap', h('table.responsive',
    h('thead', h('tr', refHead.map(t => h('th', t)))),
    h('tbody', items.map(it => h('tr',
      h('td', { 'data-label': '#' }, String(it.code)),
      h('td', { 'data-label': 'البند' }, it.name),
      h('td', { 'data-label': 'الوحدة' }, it.unit),
      h('td', { 'data-label': 'سعر الوحدة' }, it.unit_price == null ? '—' : money(it.unit_price)),
      h('td', { 'data-label': 'الكمية التعاقدية' }, it.qty_contracted == null ? '—' : qty(it.qty_contracted)),
      h('td', { 'data-label': 'قيمة البند' }, money(it.total_value))))),
    h('tfoot', h('tr.total-row',
      h('td', { colspan: '5' }, 'إجمالي قيمة العقد قبل الضريبة'),
      h('td', money(items.reduce((s, r) => s + Number(r.total_value || 0), 0)))))));


  // ---------------- لوحةُ مؤشرات البنود (ملاحظة ٢٤١) ----------------
  //   كمياتٌ لا ماليات: لا سعرَ ولا قيمةَ هنا، فالأسعارُ في جدول المستخلص
  //   خلف مفتاحها. وثلاثُ بطاقاتٍ في الصف كما طُلب.
  const ITEM_ICON = { 1: 'pen', 2: 'mic', 3: 'shield', 4: 'bolt',
    5: 'book', 6: 'check', 7: 'map' };

  const elapsedPct = () => {
    if (!started.value) return null;
    const from = new Date(started.value + '-01T12:00:00');
    const months = Math.max(0, (new Date().getFullYear() - from.getFullYear()) * 12
      + (new Date().getMonth() - from.getMonth()));
    return Math.min(100, (months / MONTHS) * 100);
  };

  // لونُ الحال: سابقٌ لمضيّ المدة، أو مقاربٌ، أو متخلّف
  const trend = (done, total) => {
    const e = elapsedPct();
    if (!(Number(total) > 0)) return '';
    const p = pct(done, total);
    if (e === null) return '';
    if (p >= e) return 'ok';
    if (p >= e - 10) return 'warn';
    return 'bad';
  };

  const kpiTile = ({ ico, label, value, unit, sub, extra, state, done, total }) =>
    h(`article.kpi-tile${state ? '.is-' + state : ''}`,
      h('div.kpi-head', icon(ico, { size: 20 }), h('b', label)),
      h('div.kpi-num', value, unit ? h('span.kpi-unit', unit) : null),
      Number(total) > 0 ? bar(done, total) : null,
      sub ? h('p.small.muted', sub) : null,
      extra ? h('p.small.gold', extra) : null);

  const kpiBoard = h('div.stack');
  const drawKpi = () => {
    const e = elapsedPct();
    const doneAll = items.reduce((a, r) => a + Number(r.qty_done || 0), 0);
    const totalAll = items.reduce((a, r) => a + Number(r.qty_contracted || 0), 0);
    const initAll = items.reduce((a, r) => a + Number(r.qty_initiative || 0), 0);
    const overall = totalAll > 0 ? pct(doneAll, totalAll) : 0;

    kpiBoard.replaceChildren(
      h('div.kpi-grid',
        kpiTile({ ico: 'chart', label: 'الإنجاز الإجمالي',
          value: `${overall.toFixed(1)}٪`,
          sub: totalAll > 0 ? `${qty(doneAll)} من ${qty(totalAll)}` : 'الكمياتُ تُحدَّد إداريًّا',
          done: doneAll, total: totalAll, state: trend(doneAll, totalAll) }),
        kpiTile({ ico: 'clock', label: 'ما مضى من المدة',
          value: e === null ? '—' : `${e.toFixed(1)}٪`,
          sub: e === null ? 'حدّد شهر بداية العقد' : `من ${ar(MONTHS)} شهرًا` }),
        kpiTile({ ico: 'layers', label: 'بنودُ العقد',
          value: ar(items.length), unit: 'بندًا',
          sub: `${items.filter(r => Number(r.qty_done) > 0).length} بندًا بدأ العملُ فيه` }),
        kpiTile({ ico: 'star', label: 'مبادرةُ المتعاقد',
          value: qty(initAll), unit: 'عملًا',
          sub: 'بلا مقابل — لا تدخل الكمية المحتسَبة' })),
      h('div.kpi-grid', items.map(it => {
        const done = Number(it.qty_done || 0), total = Number(it.qty_contracted || 0);
        return kpiTile({
          ico: ITEM_ICON[it.code] || 'doc',
          label: `${it.code}) ${it.name}`,
          value: qty(done), unit: it.unit,
          done, total, state: trend(done, total),
          sub: total > 0
            ? `${pct(done, total).toFixed(1)}٪ من ${qty(total)} — المتبقي ${qty(Math.max(0, total - done))}`
            : 'كميتُه تُحدَّد إداريًّا',
          extra: Number(it.qty_initiative) > 0
            ? `＋ ${qty(it.qty_initiative)} بلا مقابل` : null });
      })),
      h('p.small.muted', 'كمياتٌ لا ماليات: الأسعارُ في مسودّة المستخلص خلف مفتاحها. '
        + 'ولونُ الشريط يقارن الإنجازَ بمضيّ المدة.'));
  };
  drawKpi();
  started.addEventListener('change', drawKpi);

  // ---------------- لوحةُ المبادرة ----------------
  const initKpi = inits.length ? h('div.kpi-grid.kpi-gold',
    kpiTile({ ico: 'globe', label: 'لغاتٌ بلا مقابل', value: ar(inits.length), unit: 'لغة',
      sub: inits.map(r => r.name_ar).join('، ') }),
    kpiTile({ ico: 'mic', label: 'الخطب',
      value: qty(inits.reduce((a, r) => a + Number(r.sermons || 0), 0)) }),
    kpiTile({ ico: 'doc', label: 'النصوص',
      value: qty(inits.reduce((a, r) => a + Number(r.texts || 0), 0)) }),
    kpiTile({ ico: 'pen', label: 'كلماتُ الأصل',
      value: qty(inits.reduce((a, r) => a + Number(r.words || 0), 0)) }),
    kpiTile({ ico: 'layers', label: 'مجموعُ الأعمال',
      value: qty(inits.reduce((a, r) => a + Number(r.tracks || 0), 0)) }),
    kpiTile({ ico: 'calendar', label: 'من تاريخ',
      value: (() => {
        const d = inits.map(r => r.since).filter(Boolean).sort()[0];
        return d ? fmtDate(d) : '—';
      })() })) : null;

  // ---------------- مبادرةُ المتعاقد: لغاتٌ بلا مقابل (ملاحظة ١٩٤) ----------------
  const initCard = inits.length ? h('section.card.stack.init-card',
    h('div.row.between',
      h('h3', 'مبادرةُ المتعاقد — لغاتٌ بلا مقابل'),
      h('span.badge.gold', `${ar(inits.length)} لغة`)),
    h('p.small.muted', 'العقد يطلب إحدى عشرة لغةً بالخطبة الأسبوعية. وهذه لغاتٌ زادها المتعاقد '
      + 'من عنده ولا يأخذ عليها شيئًا: تُنجز أعمالُها في المنصة كما تُنجز غيرها، '
      + 'وتُستثنى من كميات المستخلص.'),
    initKpi,
    h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['اللغة', 'الخطب', 'النصوص', 'كلمات الأصل', 'مجموع الأعمال', 'من تاريخ']
        .map(t => h('th', t)))),
      h('tbody', inits.map(r => h('tr',
        h('td', { 'data-label': 'اللغة' }, h('b', r.name_ar),
          r.note ? h('span.sub', r.note) : null),
        h('td', { 'data-label': 'الخطب' }, qty(r.sermons)),
        h('td', { 'data-label': 'النصوص' }, qty(r.texts)),
        h('td', { 'data-label': 'كلمات الأصل' }, qty(r.words)),
        h('td', { 'data-label': 'مجموع الأعمال' }, h('b', qty(r.tracks))),
        h('td', { 'data-label': 'من تاريخ' }, r.since ? fmtDate(r.since) : '—')))),
      h('tfoot', h('tr.total-row',
        h('td', 'المجموع'),
        h('td', qty(inits.reduce((a, r) => a + Number(r.sermons || 0), 0))),
        h('td', qty(inits.reduce((a, r) => a + Number(r.texts || 0), 0))),
        h('td', qty(inits.reduce((a, r) => a + Number(r.words || 0), 0))),
        h('td', qty(inits.reduce((a, r) => a + Number(r.tracks || 0), 0))),
        h('td', ''))))),
    h('p.small.muted', 'تُضمّ اللغة إلى المبادرة أو تُخرج منها من شاشة «اللغات».')) : null;

  // ---------------- التبويبات: النطاق أولًا، ثم الكميات والمستخلص والتقرير ----------------

  const quantitiesPane = () => h('div.stack',
    h('section.card.stack',
      h('h3', 'شريط الكميات التعاقدية'),
      h('label.field', { style: { maxWidth: '18rem' } }, 'شهر بداية العقد', started),
      elapsed),
    kpiBoard,
    quantities,
    initCard,
    h('section.card.stack',
      h('h3', 'جدول الكميات والأسعار كما في كراسة المواصفات'),
      refTable,
      h('p.small.muted', 'هذا الجدول مرجعٌ من العقد. لا تُطبَّق قيمه على أجور الفريق، ولا يُحسم بها شيء آليًّا؛ '
        + 'والغرامات ونسب التقييم تُعرض بيانًا للإدارة لا تطبيقًا.')));

  // أزرارُ التصدير في الأعلى بعد اختيار الشهر مباشرة (ملاحظة ٢١٦)
  const claimPane = () => h('div.stack',
    h('section.card.stack',
      h('h3', 'مسودّة المستخلص الشهري'),
      h('div.export-bar',
        h('label.field', 'الشهر', monthIn),
        h('label.field', 'صيغة التصدير', fmtSel),
        h('div.field', h('span.field-head', '\u200b'), expBtn)),
      h('label.field.row', { style: { alignItems: 'center', gap: '8px' } },
        withPrices, h('span', 'إظهار قيم الكراسة (مسودّة مطالبة)')),
      claimBox));

  const TABS = [
    ['scope', 'نطاق العقد'],
    ['qty', 'البنود والكميات'],
    ['claim', 'مسودّة المستخلص'],
    ['ops', 'التقرير الشهري'],
    ['penalties', 'الجزاءات']
  ];
  const want = TABS.some(t => t[0] === ctx.query?.get('tab')) ? ctx.query.get('tab') : 'scope';
  const panel = h('div.staff-panel');
  const btns = TABS.map(([key, label]) => {
    const b2 = h('button.btn.tab', { type: 'button', role: 'tab' }, label);
    b2.onclick = () => show(key);
    return b2;
  });

  async function show(key) {
    btns.forEach((b2, i) => {
      const on = TABS[i][0] === key;
      b2.classList.toggle('on', on);
      b2.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    history.replaceState(null, '', key === 'scope' ? '/app/contract' : `/app/contract?tab=${key}`);
    panel.replaceChildren(h('p.small.muted', 'جارٍ التحميل…'));
    try {
      panel.replaceChildren(
        key === 'qty' ? quantitiesPane()
        : key === 'claim' ? claimPane()
        : key === 'ops' ? await opsSection()
        : key === 'penalties' ? await penaltySection()
        : scopeSection());
    } catch (err) { panel.replaceChildren(h('p.small.bad', err.message)); }
  }

  const view = h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'بنود العقد والمستخلص'),
        h('p.muted', 'نطاقُ العقد كما نصّ عليه، وكمياتُ الإنجاز أمام الكميات التعاقدية، '
          + 'ومسودّةُ مستخلصٍ شهري، والتقريرُ الشهري للتكاليف التشغيلية، '
          + 'وجزاءاتُ العقد بسقفها.'))),
    h('div.tabs', { role: 'tablist' }, btns),
    panel,
    admin ? null : h('p.small.muted', 'والتعديلُ في هذه الشاشة لمدير المشروع.'));
  await show(want);
  return view;
}
