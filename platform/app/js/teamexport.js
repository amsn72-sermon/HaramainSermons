// تصدير بيانات فريق العمل: اختيار الأعضاء والحقول، إلى Excel أو Word أو PDF على الكليشة (ملاحظة ٧٨)
import { h, escapeHtml, fmtDate } from './ui.js';
import { PAGE, LETTERHEAD } from './page.js';
import { buildXlsx, downloadBlob } from './xlsx.js';
import { STATUS_LABEL, langName, roleName } from './store.js';

// توحيدُ أرقام الجوال في التصدير على الصيغة الدولية (ملاحظة ٢٥٥ ب)
//   والمحفوظُ في قاعدة البيانات يبقى كما أدخله صاحبُه، فالتوحيدُ عرضٌ
//   لا تغيير.
export function intlPhone(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+')) return d;
  d = d.replace(/\D/g, '');
  if (d.startsWith('966')) return '+' + d;
  if (d.startsWith('05') && d.length === 10) return '+966' + d.slice(1);
  if (d.startsWith('5') && d.length === 9) return '+966' + d;
  return d ? '+' + d : raw;
}

// الحقول المتاحة: [المفتاح، التسمية، كيف تُستخرج]
export const TEAM_FIELDS = [
  ['full_name',   'الاسم',                m => m.full_name],
  ['member_no',   'رقم العضوية',          m => m.member_no],
  ['role',        'الدور',                m => (m.job_title || roleName(m.admin_title) || roleName(m.role))],
  ['track',       'الفريق',               m => (m.track === 'field' ? 'الإرشاد المكاني' : 'الترجمة التخصصية')],
  ['status',      'الحالة',               m => STATUS_LABEL[m.status] || m.status],
  ['email',       'البريد الإلكتروني',     m => m.email],
  ['whatsapp',    'رقم الجوال',           (m, p) => intlPhone(p.whatsapp)],
  ['national_id', 'رقم الهوية أو الإقامة', (m, p) => p.national_id],
  ['nationality', 'الجنسية',              (m, p) => p.nationality],
  ['residence',   'مكان الإقامة',         (m, p) => p.residence],
  ['languages',   'اللغات',               m => (m.member_languages || []).map(x => langName(x.language_code)).join('، ')],
  ['policy',      'ميثاق العمل',         (m, p, x) => x.signed ? 'موقّعة' : 'لم توقّع'],
  // الحساب البنكي (ملاحظة ٨٤) — لا يظهر إلا لمن يرى البيانات المالية
  ['bank_name',   'اسم البنك',            (m, p, x) => x.bank?.bank_name],
  ['iban',        'الآيبان (IBAN)',        (m, p, x) => groupIban(x.bank?.iban) || x.bank?.account_number],
  ['swift',       'سويفت (BIC)',          (m, p, x) => x.bank?.swift],
  ['bank_holder', 'اسم صاحب الحساب',      (m, p, x) => x.bank?.account_holder],
  ['bank_state',  'توثيق الحساب',         (m, p, x) => !x.bank ? 'لم يُسجَّل' : (x.bank.verified_at ? 'موثّق' : 'غير موثّق')],
  ['created_at',  'تاريخ التسجيل',        m => fmtDate(m.created_at)]
];

// الآيبان في أربعات ليسهل نسخه ومراجعته
const groupIban = v => (v ? String(v).replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim() : '');

export const fieldLabel = key => (TEAM_FIELDS.find(f => f[0] === key) || [, key])[1];

// جدول: أول صف رؤوس الأعمدة. extra أعمدة فارغة بأسماء يكتبها المستخدم (ملاحظة ٨٠)
export function teamRows(members, keys, ctx = {}) {
  const chosen = TEAM_FIELDS.filter(f => keys.includes(f[0]));
  const extra = (ctx.extraColumns || []).map(t => String(t).trim()).filter(Boolean);
  const head = [...chosen.map(f => f[1]), ...extra];
  const body = members.map(m => [
    ...chosen.map(f => String(f[2](m, ctx.privOf?.[m.id] || {},
      { signed: !!ctx.signOf?.[m.id], bank: ctx.bankOf?.[m.id] || null }) ?? '')),
    ...extra.map(() => '')
  ]);
  return [head, ...body];
}

const STAMP = () => new Date().toISOString().slice(0, 10);

export function exportExcel(rows, title = 'فريق العمل') {
  const name = (title || 'فريق العمل').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) || 'فريق العمل';
  downloadBlob(buildXlsx(rows, { sheetName: name, allText: true }), `${name} ${STAMP()}.xlsx`);
}

export async function exportWord(rows, title = 'فريق الترجمة', opts = {}) {
  const { loadDocx } = await import('./export.js');
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, WidthType, HeadingLevel } = docx;
  const cell = (text, bold) => new TableCell({
    width: { size: Math.floor(100 / rows[0].length), type: WidthType.PERCENTAGE },
    shading: bold ? { fill: 'F1E9DD' } : undefined,
    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true,
      children: [new TextRun({ text, bold: !!bold, rightToLeft: true, size: 20 })] })]
  });
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    rows: rows.map((r, i) => new TableRow({ tableHeader: i === 0, children: r.map(v => cell(v, i === 0)) }))
  });
  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: `${PAGE.w}mm`, height: `${PAGE.h}mm` },
        margin: { top: `${PAGE.top}mm`, bottom: `${PAGE.bottom}mm`, left: `${PAGE.side}mm`, right: `${PAGE.side}mm` } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: title, bold: true, rightToLeft: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true,
          children: [new TextRun({ text: opts.note || `عدد الأعضاء: ${rows.length - 1} — ${fmtDate(new Date())}`, rightToLeft: true, size: 18 })] }),
        new Paragraph({ text: '' }),
        table
      ]
    }]
  });
  const name = (title || 'فريق العمل').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) || 'فريق العمل';
  downloadBlob(await Packer.toBlob(doc), `${name} ${STAMP()}.docx`);
}

// ---------------------------------------------------------------------
// الدليل الإرشادي للمصطلحات (ملاحظة ٢٤٥ ج)
//   المصطلحُ ومقابلُه لا غير، وقسمٌ لكلِّ لغة، وعددُ أعمدةِ الصفحة كما
//   تُطبع المعاجم — فتختصر الصفحاتِ ويسهل البحثُ بالعين.
//   parts: [{ code, name, pairs: [[المصطلح, المقابل], …] }]
// ---------------------------------------------------------------------
export async function exportGuideDoc(parts, title = 'الدليل الإرشادي للمصطلحات', opts = {}) {
  const cols = Math.min(3, Math.max(1, Number(opts.cols) || 2));
  const lines = opts.shape === 'lines';
  if (opts.pdf) return guidePdf(parts, title, { ...opts, cols, lines });
  await guideWord(parts, title, { ...opts, cols, lines });
  return true;
}

function guidePdf(parts, title, { note = '', cols, lines }) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const sections = parts.map(p => {
    const items = p.pairs.map(([a, b]) => (lines
      ? `<div class="ent line"><span class="ar">${escapeHtml(a)}</span><span class="sep"> — </span><span class="tr">${escapeHtml(b)}</span></div>`
      : `<div class="ent"><span class="ar">${escapeHtml(a)}</span><span class="tr">${escapeHtml(b)}</span></div>`)).join('');
    return `<section class="lang"><h2>${escapeHtml(p.name)} <small>(${p.pairs.length})</small></h2>`
      + `<div class="flow">${items}</div></section>`;
  }).join('');
  w.document.write(`<!doctype html><html lang="ar" dir="rtl" data-theme="light"><head><meta charset="utf-8"><title></title>
<style>
  @page { size: ${PAGE.w}mm ${PAGE.h}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Haramain Arabic", "Segoe UI", Tahoma, sans-serif; color: #12202c; background: #fff; }
  .sheet { position: relative; width: ${PAGE.w}mm; min-height: ${PAGE.h}mm; overflow: hidden; }
  .sheet img.lh { position: absolute; inset: 0; width: ${PAGE.w}mm; height: ${PAGE.h}mm; object-fit: cover; z-index: 0; }
  .win { position: relative; z-index: 1; padding: ${PAGE.top}mm ${PAGE.side}mm ${PAGE.bottom + 6}mm; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 2mm; }
  .sub { text-align: center; font-size: 9pt; color: #5a6a78; margin: 0 0 6mm; }
  h2 { font-size: 11pt; margin: 4mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #c8b591; }
  h2 small { color: #7a8894; font-weight: 400; }
  .flow { column-count: ${cols}; column-gap: 6mm; column-rule: 1px solid #e3d9c8; }
  .ent { break-inside: avoid; display: flex; gap: 2mm; align-items: baseline;
         font-size: 8.5pt; padding: 1mm 0; border-bottom: 1px dotted #ddd2bd; }
  .ent .ar { font-weight: 700; flex: 0 0 auto; max-width: 48%; }
  .ent .tr { color: #334; direction: auto; unicode-bidi: plaintext; margin-inline-start: auto; text-align: start; }
  .ent.line { border-bottom: none; }
  .ent.line .tr { margin-inline-start: 0; }
  .lang { break-inside: auto; }
  @media print { .sheet { page-break-after: always; } }
</style></head><body>
<div class="sheet"><img class="lh" src="${LETTERHEAD}" alt=""><div class="win">
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${escapeHtml(note || `${parts.length} لغة — ${fmtDate(new Date())}`)}</p>
  ${sections}
</div></div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });<\/script>
</body></html>`);
  w.document.close();
  return true;
}

async function guideWord(parts, title, { note = '', cols, lines }) {
  const { loadDocx } = await import('./export.js');
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
    AlignmentType, WidthType, HeadingLevel } = docx;

  const txt = (text, bold, rtl = true) => new TextRun({ text: String(text ?? ''), bold: !!bold, rightToLeft: rtl, size: 18 });
  const cell = (children, width) => new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ bidirectional: true, children })]
  });

  // صفوفٌ تُملأ عرضًا: عمودُ صفحةٍ بعد عمود
  const chunk = (arr, n) => {
    const per = Math.ceil(arr.length / n) || 1;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr.slice(i * per, (i + 1) * per));
    return out;
  };

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: title, bold: true, rightToLeft: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true,
      children: [txt(note || `${parts.length} لغة — ${fmtDate(new Date())}`)] }),
    new Paragraph({ text: '' })
  ];

  for (const p of parts) {
    children.push(new Paragraph({ bidirectional: true, heading: HeadingLevel.HEADING_3,
      children: [new TextRun({ text: `${p.name} (${p.pairs.length})`, bold: true, rightToLeft: true })] }));
    const columns = chunk(p.pairs, cols);
    const depth = Math.max(...columns.map(c => c.length), 0);
    const perCol = Math.floor(100 / cols);
    const rows = [];
    for (let i = 0; i < depth; i++) {
      const cells = [];
      for (const col of columns) {
        const pair = col[i];
        if (!pair) { cells.push(cell([txt('')], perCol)); continue; }
        cells.push(cell(lines
          ? [txt(pair[0], true), txt(' — '), new TextRun({ text: String(pair[1]), size: 18 })]
          : [txt(pair[0], true), txt('  '), new TextRun({ text: String(pair[1]), size: 18 })], perCol));
      }
      rows.push(new TableRow({ children: cells }));
    }
    if (rows.length) {
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
        visuallyRightToLeft: true, rows }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({ sections: [{
    properties: { page: { size: { width: `${PAGE.w}mm`, height: `${PAGE.h}mm` },
      margin: { top: `${PAGE.top}mm`, bottom: `${PAGE.bottom}mm`, left: `${PAGE.side}mm`, right: `${PAGE.side}mm` } } },
    children
  }] });
  const name = (title || 'الدليل').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) || 'الدليل';
  downloadBlob(await Packer.toBlob(doc), `${name} ${STAMP()}.docx`);
}

// PDF: نافذة طباعة على كليشة الهيئة — المتصفح يحفظها PDF
//
//   والجدولُ يُقسَم صفحاتٍ، لكلِّ صفحةٍ كليشتُها ورأسُ أعمدتها، فلا
//   يمتدُّ الجدولُ على الكليشة ولا يختلط به (ملاحظة ٢٥٥ أ). وصندوقُ
//   الكتابة أقصرُ من حدِّه بقليل، احتياطًا لاختلاف المتصفحات.
const PDF_ROWS_PER_PAGE = 22;

export function exportPdf(rows, title = 'فريق الترجمة', opts = {}) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const head = rows[0].map(v => `<th>${escapeHtml(v)}</th>`).join('');
  const body = rows.slice(1);
  const per = Math.max(6, Number(opts.rowsPerPage) || PDF_ROWS_PER_PAGE);
  const pages = [];
  for (let i = 0; i < body.length; i += per) pages.push(body.slice(i, i + per));
  if (!pages.length) pages.push([]);

  const sub = escapeHtml(opts.note || `عدد الأعضاء: ${body.length} — ${fmtDate(new Date())}`);
  const sheets = pages.map((chunk, pi) => {
    const trs = chunk.map((r, i) =>
      `<tr><td class="n">${pi * per + i + 1}</td>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
    return `<div class="sheet"><img class="lh" src="${LETTERHEAD}" alt=""><div class="win">
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${sub}${pages.length > 1 ? ` — صفحة ${pi + 1} من ${pages.length}` : ''}</p>
      <table><thead><tr><th>م</th>${head}</tr></thead><tbody>${trs}</tbody></table>
    </div></div>`;
  }).join('');

  w.document.write(`<!doctype html><html lang="ar" dir="rtl" data-theme="light"><head><meta charset="utf-8"><title></title>
<style>
  @page { size: ${PAGE.w}mm ${PAGE.h}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Haramain Arabic", "Segoe UI", Tahoma, sans-serif; color: #12202c; background: #fff; }
  .sheet { position: relative; width: ${PAGE.w}mm; height: ${PAGE.h}mm; overflow: hidden; }
  .sheet img.lh { position: absolute; inset: 0; width: ${PAGE.w}mm; height: ${PAGE.h}mm; object-fit: cover; z-index: 0; }
  /* صندوقُ الكتابة محدودُ الارتفاع: ما زاد لا يفيض على الكليشة */
  .win { position: relative; z-index: 1; padding: ${PAGE.top}mm ${PAGE.side}mm ${PAGE.bottom + 10}mm;
         height: ${PAGE.h}mm; overflow: hidden; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 2mm; }
  .sub { text-align: center; font-size: 9pt; color: #5a6a78; margin: 0 0 5mm; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
  th, td { border: 1px solid #c8b591; padding: 1.6mm 1.2mm; text-align: center;
           word-wrap: break-word; overflow-wrap: anywhere; }
  th { background: #f1e9dd; font-weight: 700; }
  td.n, th:first-child { color: #7a8894; width: 9mm; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
</style></head><body>
${sheets}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });<\/script>
</body></html>`);
  w.document.close();
  return true;
}

// ---------------------------------------------------------------------
// تصديرُ الدليل بهيئة المعاجم (ملاحظة ٢٦٢)
//
//   ثلاثةُ أعمدةٍ في الصفحة، في كلِّ سطر «المصطلح : مقابلُه»، لا جدولَ
//   ولا حدود. ورأسُ الصفحة كما في المعاجم: أوّلُ مدخلٍ فيها وآخرُه
//   والرقمُ بينهما. والكليشةُ في الصفحة الأولى وحدَها، ثم تخلو الصفحاتُ
//   للمداخل فلا تزاحمها ترويسةٌ في كل صفحة.
// ---------------------------------------------------------------------
const AR_LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const arLetter = s => {
  const t = String(s ?? '').replace(/[ً-ْـ‏‎]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
  const c = t.charAt(0);
  return AR_LETTERS.includes(c) ? c : '';
};

export async function exportDictionary(parts, title = 'الدليل الإرشادي للمصطلحات', opts = {}) {
  const cols = Math.min(3, Math.max(1, Number(opts.cols) || 3));
  if (opts.pdf) return dictPdf(parts, title, { ...opts, cols });
  await guideWord(parts, title, { ...opts, cols, lines: false });
  return true;
}

function dictPdf(parts, title, { note = '', cols, letters = true }) {
  const w = window.open('', '_blank');
  if (!w) return false;

  const sections = parts.map(p => {
    let last = null;
    const items = p.pairs.map(([a, b]) => {
      let head = '';
      if (letters) {
        const L = arLetter(a);
        if (L && L !== last) { last = L; head = `<div class="lh-letter">${escapeHtml(L)}</div>`; }
      }
      return head
        + `<div class="ent" data-ar="${escapeHtml(a)}">`
        + `<span class="ar">${escapeHtml(a)}</span>`
        + `<span class="sep">:</span>`
        + `<span class="tr">${escapeHtml(b)}</span></div>`;
    }).join('');
    return `<section class="lang"><h2>${escapeHtml(p.name)} <small>(${p.pairs.length})</small></h2>`
      + `<div class="flow">${items}</div></section>`;
  }).join('');

  w.document.write(`<!doctype html><html lang="ar" dir="rtl" data-theme="light"><head><meta charset="utf-8"><title></title>
<style>
  @page { size: ${PAGE.w}mm ${PAGE.h}mm; margin: 14mm 14mm 16mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Haramain Arabic", "Segoe UI", Tahoma, sans-serif;
         color: #12202c; background: #fff; }
  /* الصفحةُ الأولى على الكليشة، ثم تخلو الصفحاتُ للمداخل */
  .cover { position: relative; width: ${PAGE.w}mm; height: ${PAGE.h}mm; overflow: hidden;
           page-break-after: always; }
  .cover img.lh { position: absolute; inset: 0; width: ${PAGE.w}mm; height: ${PAGE.h}mm; object-fit: cover; }
  .cover .win { position: relative; z-index: 1; padding: ${PAGE.top + 30}mm ${PAGE.side}mm 0;
                text-align: center; }
  .cover h1 { font-size: 22pt; margin: 0 0 4mm; }
  .cover .sub { font-size: 11pt; color: #5a6a78; }
  h2 { font-size: 12pt; margin: 0 0 3mm; padding-bottom: 1mm; border-bottom: 1px solid #c8b591;
       column-span: all; }
  h2 small { color: #7a8894; font-weight: 400; }
  .flow { column-count: ${cols}; column-gap: 7mm; column-rule: 1px solid #e3d9c8; }
  .ent { break-inside: avoid; font-size: 8.5pt; padding: .8mm 0; line-height: 1.6; }
  .ent .ar { font-weight: 700; }
  .ent .sep { color: #9a8a6c; margin: 0 1mm; }
  .ent .tr { direction: auto; unicode-bidi: plaintext; }
  /* ما طال فلا يُشوَّه العمودُ من أجله: ينزل على عرض الصفحة */
  .ent.wide { column-span: all; }
  .lh-letter { break-inside: avoid; break-before: auto; margin: 3mm 0 1.5mm; text-align: center;
               font-size: 13pt; font-weight: 700; color: #b9975b; border-bottom: .3mm solid #e3d9c8;
               padding-bottom: 1mm; }
  /* رأسُ الصفحة: أوّلُ مدخلٍ وآخرُه والرقمُ بينهما، كما في المعاجم */
  .runner { position: running(head); }
  @media print { .lang { break-before: page; } .lang:first-child { break-before: auto; } }
</style></head><body>
<div class="cover"><img class="lh" src="${LETTERHEAD}" alt=""><div class="win">
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${escapeHtml(note || '')}</p>
  <p class="sub">${escapeHtml(parts.map(p => p.name).join(' · '))} — ${escapeHtml(fmtDate(new Date()))}</p>
</div></div>
${sections}
<script>
// رأسُ الصفحة يُرسَم بعد التصفيف: يُقرأ أوّلُ مدخلٍ ظاهرٍ في كلِّ صفحةٍ
// وآخرُه، فيُكتبان في شريطٍ أعلاها مع رقمها
window.addEventListener('load', function () {
  try {
    var ents = Array.prototype.slice.call(document.querySelectorAll('.ent'));
    var H = ${PAGE.h} * 96 / 25.4;
    var pages = {};
    ents.forEach(function (el) {
      var p = Math.floor(el.getBoundingClientRect().top / H);
      if (!pages[p]) pages[p] = [];
      pages[p].push(el.getAttribute('data-ar'));
    });
    Object.keys(pages).forEach(function (p) {
      var list = pages[p];
      var bar = document.createElement('div');
      bar.className = 'page-head-bar';
      bar.style.cssText = 'position:absolute;left:0;right:0;top:' + (p * H + 6) + 'px;'
        + 'display:flex;justify-content:space-between;align-items:center;gap:8px;'
        + 'font-size:8pt;color:#8a7a5c;border-bottom:.3mm solid #e3d9c8;padding:0 2mm 1mm;';
      bar.innerHTML = '<span>' + list[0] + '</span><b>' + (Number(p) + 1) + '</b><span>'
        + list[list.length - 1] + '</span>';
      document.body.appendChild(bar);
    });
  } catch (e) { /* يبقى المعجمُ بلا رؤوسٍ ولا يضرّ */ }
  setTimeout(function () { window.print(); }, 450);
});
<\/script>
</body></html>`);
  w.document.close();
  return true;
}
