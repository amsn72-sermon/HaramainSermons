// تصدير بيانات فريق العمل: اختيار الأعضاء والحقول، إلى Excel أو Word أو PDF على الكليشة (ملاحظة ٧٨)
import { h, escapeHtml, fmtDate } from './ui.js';
import { PAGE, LETTERHEAD } from './page.js';
import { buildXlsx, downloadBlob } from './xlsx.js';
import { ROLE_LABEL, STATUS_LABEL, langName } from './store.js';

// الحقول المتاحة: [المفتاح، التسمية، كيف تُستخرج]
export const TEAM_FIELDS = [
  ['full_name',   'الاسم',                m => m.full_name],
  ['member_no',   'رقم العضوية',          m => m.member_no],
  ['role',        'الدور',                m => ROLE_LABEL[m.role] || m.role],
  ['track',       'الفريق',               m => (m.track === 'field' ? 'الإرشاد المكاني' : 'الترجمة التخصصية')],
  ['status',      'الحالة',               m => STATUS_LABEL[m.status] || m.status],
  ['email',       'البريد الإلكتروني',     m => m.email],
  ['whatsapp',    'رقم الجوال',           (m, p) => p.whatsapp],
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

// PDF: نافذة طباعة على كليشة الهيئة — المتصفح يحفظها PDF
export function exportPdf(rows, title = 'فريق الترجمة', opts = {}) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const head = rows[0].map(v => `<th>${escapeHtml(v)}</th>`).join('');
  const body = rows.slice(1).map((r, i) =>
    `<tr><td class="n">${i + 1}</td>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
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
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { border: 1px solid #c8b591; padding: 2mm 1.5mm; text-align: center; }
  th { background: #f1e9dd; font-weight: 700; }
  td.n { color: #7a8894; width: 10mm; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  @media print { .sheet { page-break-after: always; } }
</style></head><body>
<div class="sheet"><img class="lh" src="${LETTERHEAD}" alt=""><div class="win">
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${escapeHtml(opts.note || `عدد الأعضاء: ${rows.length - 1} — ${fmtDate(new Date())}`)}</p>
  <table><thead><tr><th>م</th>${head}</tr></thead><tbody>${body}</tbody></table>
</div></div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });<\/script>
</body></html>`);
  w.document.close();
  return true;
}
