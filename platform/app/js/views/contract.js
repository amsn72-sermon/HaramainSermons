// بنود العقد وكمياته، ومسودّة المستخلص الشهري (ملاحظتا ١٤٨ و١٥١)
//   الأسعار مرجعٌ من كراسة المواصفات: تُعرض حين تُطلب، ولا تُطبَّق على أحد،
//   ولا تُحسم غرامة ولا يُربط بها أجر عضو.
import { h, toast, busy, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { isManager } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';
import { scopeSection } from './scope.js';
import { opsSection } from '../opsreport.js';

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

  async function loadClaim() {
    const m = (monthIn.value || new Date().toISOString().slice(0, 7)) + '-01';
    try {
      const r = await db.rpc('claim_month', { p_month: m });
      claim = Array.isArray(r) ? r : [];
    } catch (err) { claim = []; toast(err.message, 'bad'); }
    drawClaim();
  }

  function claimRows() {
    const show = withPrices.checked;
    const head = show
      ? ['البند', 'الوحدة', 'الكمية المحتسَبة', 'مبادرة بلا مقابل', 'سعر الوحدة', 'القيمة']
      : ['البند', 'الوحدة', 'الكمية المحتسَبة', 'مبادرة بلا مقابل'];
    const initQ = r => (Number(r.qty_initiative) > 0 ? qty(r.qty_initiative) : '—');
    const body = claim.map(r => show
      ? [r.name, r.unit, qty(r.qty_done), initQ(r),
         r.unit_price == null ? '—' : money(r.unit_price),
         r.unit_price == null ? '—' : money(r.amount)]
      : [r.name, r.unit, qty(r.qty_done), initQ(r)]);
    if (show) {
      const sum = claim.reduce((s, r) => s + Number(r.amount || 0), 0);
      body.push(['الإجمالي قبل الضريبة', '', '', '', '', money(sum)]);
      body.push(['ضريبة القيمة المضافة ١٥٪', '', '', '', '', money(sum * 0.15)]);
      body.push(['الإجمالي المطالَب به', '', '', '', '', money(sum * 1.15)]);
    }
    return { head, body };
  }

  function drawClaim() {
    const { head, body } = claimRows();
    claimBox.replaceChildren(
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', head.map(t => h('th', t)))),
        h('tbody', body.length ? body.map((r, i) => h('tr',
          { class: i >= claim.length ? 'total-row' : '' },
          r.map((v, c) => h('td', { 'data-label': head[c] }, v))))
          : [h('tr', h('td', { colspan: String(head.length) }, h('p.muted', 'لا كميات في هذا الشهر.')))]))),
      withPrices.checked
        ? h('p.small.muted', CLAIM_NOTE)
        : h('p.small.muted', 'الكميات وحدها. وبتأشير «إظهار قيم الكراسة» تُطبَّق أسعار العقد فتخرج مسودّة المطالبة.'),
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
    const { head, body } = claimRows();
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

  // ---------------- مبادرةُ المتعاقد: لغاتٌ بلا مقابل (ملاحظة ١٩٤) ----------------
  const initCard = inits.length ? h('section.card.stack.init-card',
    h('div.row.between',
      h('h3', 'مبادرةُ المتعاقد — لغاتٌ بلا مقابل'),
      h('span.badge.gold', `${ar(inits.length)} لغة`)),
    h('p.small.muted', 'العقد يطلب إحدى عشرة لغةً بالخطبة الأسبوعية. وهذه لغاتٌ زادها المتعاقد '
      + 'من عنده ولا يأخذ عليها شيئًا: تُنجز أعمالُها في المنصة كما تُنجز غيرها، '
      + 'وتُستثنى من كميات المستخلص.'),
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
    quantities,
    initCard,
    h('section.card.stack',
      h('h3', 'جدول الكميات والأسعار كما في كراسة المواصفات'),
      refTable,
      h('p.small.muted', 'هذا الجدول مرجعٌ من العقد. لا تُطبَّق قيمه على أجور الفريق، ولا يُحسم بها شيء آليًّا؛ '
        + 'والغرامات ونسب التقييم تُعرض بيانًا للإدارة لا تطبيقًا.')));

  const claimPane = () => h('div.stack',
    h('section.card.stack',
      h('div.row.between', h('h3', 'مسودّة المستخلص الشهري'),
        h('div.row', fmtSel, expBtn)),
      h('div.grid-2',
        h('label.field', 'الشهر', monthIn),
        h('label.field.row', { style: { alignItems: 'center', gap: '8px' } },
          withPrices, h('span', 'إظهار قيم الكراسة (مسودّة مطالبة)'))),
      claimBox));

  const TABS = [
    ['scope', 'نطاق العقد'],
    ['qty', 'البنود والكميات'],
    ['claim', 'مسودّة المستخلص'],
    ['ops', 'التقرير الشهري']
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
        : scopeSection());
    } catch (err) { panel.replaceChildren(h('p.small.bad', err.message)); }
  }

  const view = h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'بنود العقد والمستخلص'),
        h('p.muted', 'نطاقُ العقد كما نصّ عليه، وكمياتُ الإنجاز أمام الكميات التعاقدية، '
          + 'ومسودّةُ مستخلصٍ شهري، والتقريرُ الشهري للتكاليف التشغيلية.'))),
    h('div.tabs', { role: 'tablist' }, btns),
    panel,
    admin ? null : h('p.small.muted', 'اطّلاعٌ فقط.'));
  await show(want);
  return view;
}
