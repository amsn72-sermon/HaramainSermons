// بنود العقد وكمياته، ومسودّة المستخلص الشهري (ملاحظتا ١٤٨ و١٥١)
//   الأسعار مرجعٌ من كراسة المواصفات: تُعرض حين تُطلب، ولا تُطبَّق على أحد،
//   ولا تُحسم غرامة ولا يُربط بها أجر عضو.
import { h, toast, busy, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';

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
  const rows = await db.rpc('contract_progress').catch(() => []);
  const items = Array.isArray(rows) ? rows : [];
  const admin = isAdmin();

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
      ? ['البند', 'الوحدة', 'الكمية', 'سعر الوحدة', 'القيمة']
      : ['البند', 'الوحدة', 'الكمية'];
    const body = claim.map(r => show
      ? [r.name, r.unit, qty(r.qty_done), r.unit_price == null ? '—' : money(r.unit_price), r.unit_price == null ? '—' : money(r.amount)]
      : [r.name, r.unit, qty(r.qty_done)]);
    if (show) {
      const sum = claim.reduce((s, r) => s + Number(r.amount || 0), 0);
      body.push(['الإجمالي قبل الضريبة', '', '', '', money(sum)]);
      body.push(['ضريبة القيمة المضافة ١٥٪', '', '', '', money(sum * 0.15)]);
      body.push(['الإجمالي المطالَب به', '', '', '', money(sum * 1.15)]);
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
        : h('p.small.muted', 'الكميات وحدها. وبتأشير «إظهار قيم الكراسة» تُطبَّق أسعار العقد فتخرج مسودّة المطالبة.'));
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

  return h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'بنود العقد والمستخلص'),
        h('p.muted', 'كميات الإنجاز أمام الكميات التعاقدية، ومسودّة مستخلصٍ شهري تُطبع وتُرفع للهيئة.'))),

    h('section.card.stack',
      h('h3', 'شريط الكميات التعاقدية'),
      h('label.field', { style: { maxWidth: '18rem' } }, 'شهر بداية العقد', started),
      elapsed),
    quantities,

    h('section.card.stack',
      h('div.row.between', h('h3', 'مسودّة المستخلص الشهري'),
        h('div.row', fmtSel, expBtn)),
      h('div.grid-2',
        h('label.field', 'الشهر', monthIn),
        h('label.field.row', { style: { alignItems: 'center', gap: '8px' } },
          withPrices, h('span', 'إظهار قيم الكراسة (مسودّة مطالبة)'))),
      claimBox),

    h('section.card.stack',
      h('h3', 'جدول الكميات والأسعار كما في كراسة المواصفات'),
      refTable,
      h('p.small.muted', 'هذا الجدول مرجعٌ من العقد. لا تُطبَّق قيمه على أجور الفريق، ولا يُحسم بها شيء آليًّا؛ '
        + 'والغرامات ونسب التقييم تُعرض بيانًا للإدارة لا تطبيقًا.')),

    admin ? null : h('p.small.muted', 'اطّلاعٌ فقط.'));
}
