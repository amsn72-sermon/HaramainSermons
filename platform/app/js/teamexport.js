// تصدير بيانات فريق العمل: اختيار الأعضاء والحقول، إلى Excel أو Word أو PDF على الكليشة (ملاحظة ٧٨)
import { h, escapeHtml, fmtDate, fmtHijri } from './ui.js';
import { PAGE, LETTERHEAD } from './page.js';
import { buildXlsx, downloadBlob } from './xlsx.js';
import { openSheetWindow, measureBlocks, flowBlocks, mm2px, sheetCss,
  winHeight, boxWidth } from './sheetflow.js';
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

// PDF: نافذة طباعة على كليشة الهيئة — المتصفح يحفظها PDF
//
//   والجدولُ يُقاس صفًّا صفًّا ويُوزَّع على صفحاتٍ حقيقية، لكلِّ صفحةٍ
//   كليشتُها ورأسُ أعمدتها، فلا يفيض على الكليشة ولا يختلط بها
//   (ملاحظتا ٢٥٥ و٢٧٤).
export function exportPdf(rows, title = 'فريق الترجمة', opts = {}) {
  const head = rows[0].map(v => `<th>${escapeHtml(v)}</th>`).join('');
  const body = rows.slice(1);
  const sub = escapeHtml(opts.note || `عدد الأعضاء: ${body.length} — ${fmtDate(new Date())}`);

  const ctx = openSheetWindow(sheetCss(`
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
  th, td { border: 1px solid #c8b591; padding: 1.6mm 1.2mm; text-align: center;
           word-wrap: break-word; overflow-wrap: anywhere; }
  th { background: #f1e9dd; font-weight: 700; }
  td.n, th:first-child { color: #7a8894; width: 9mm; }`));
  if (!ctx) return false;
  const { el, pages, measure, w } = ctx;

  ctx.ready(() => {
    // القياسُ داخل جدولٍ مثلِ المطبوع، فالصفُّ لا يُقاس خارج جدوله
    measure.innerHTML = `<table><thead><tr><th>م</th>${head}</tr></thead><tbody></tbody></table>`;
    const mTable = measure.firstElementChild;
    const mBody = mTable.querySelector('tbody');
    const headPx = mTable.querySelector('thead').getBoundingClientRect().height;

    const blocks = body.map((r, i) => ({
      html: `<tr><td class="n">${i + 1}</td>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`
    }));
    measureBlocks(w, mBody, blocks);

    const sheets = [];
    const nextBox = () => {
      const { sheet, win } = ctx.sheet();
      if (!sheets.length) {
        win.append(el('h1', null, escapeHtml(title)));
        win.append(el('p', 'sub', sub));
      }
      win.insertAdjacentHTML('beforeend',
        `<table><thead><tr><th>م</th>${head}</tr></thead><tbody></tbody></table>`);
      sheets.push(sheet);
      return win.querySelector('tbody');
    };

    // الصفحةُ الأولى أضيقُ بعنوانها: يُزاد ارتفاعُه على أوّل كتلة
    if (blocks.length) blocks[0].h += mm2px(16);
    flowBlocks(blocks, mm2px(winHeight()) - headPx, nextBox);

    sheets.forEach((sh, i) => sh.append(el('div', 'pageno', `${i + 1} / ${sheets.length}`)));
    pages.replaceChildren(...sheets);
    measure.remove();
  });
  return true;
}

// ---------------------------------------------------------------------
// الدليل الإرشادي للمصطلحات (ملاحظة ٢٤٥ ج)
//   المصطلحُ ومقابلُه لا غير، وقسمٌ لكلِّ لغة، وعددُ أعمدةِ الصفحة كما
//   تُطبع المعاجم — فتختصر الصفحاتِ ويسهل البحثُ بالعين.
//   parts: [{ code, name, pairs: [[المصطلح, المقابل], …] }]
// ---------------------------------------------------------------------
export async function exportGuideDoc(parts, title = 'الدليل الإرشادي للمصطلحات', opts = {}) {
  const cols = Math.min(3, Math.max(1, Number(opts.cols) || 2));
  // صفحاتُ PDF تُقطع بأيدينا كما في المعجم، فلا يخرج الملفُّ صفحةً
  // واحدةً ممتدّة (ملاحظة ٢٧٤)
  if (opts.pdf) return dictPdf(parts, title, { ...opts, cols, letters: false });
  await guideWord(parts, title, { ...opts, cols, lines: opts.shape === 'lines' });
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

// ---------------------------------------------------------------------
// تصديرُ الدليل بهيئة المعاجم (ملاحظة ٢٦٢)
//
//   ثلاثةُ أعمدةٍ في الصفحة، في كلِّ سطر «المصطلح : مقابلُه»، لا جدولَ
//   ولا حدود. ورأسُ الصفحة كما في المعاجم: أوّلُ مدخلٍ فيها وآخرُه
//   والرقمُ بينهما. والكليشةُ في الصفحة الأولى وحدَها، ثم تخلو الصفحاتُ
//   للمداخل فلا تزاحمها ترويسةٌ في كل صفحة.
// ---------------------------------------------------------------------
const AR_LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
// المعاجمُ تُرتِّب بالجذر لا بـ«ال» التعريف: «الاعتكاف» في العين،
// و«التقوى» في التاء. فتُنزع «ال» ما بقي بعدها حرفان فأكثر.
export const arBare = s => {
  const t = String(s ?? '').replace(/[\u064b-\u0652\u0640\u200f\u200e]/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, 'ا').replace(/\u0629/g, 'ه')
    .replace(/\u0649/g, 'ي').trim();
  const bare = t.replace(/^ال/, '');
  return bare.length >= 2 ? bare : t;
};
const arLetter = s => {
  const c = arBare(s).charAt(0);
  return AR_LETTERS.includes(c) ? c : '';
};

export async function exportDictionary(parts, title = 'الدليل الإرشادي للمصطلحات', opts = {}) {
  const cols = Math.min(3, Math.max(1, Number(opts.cols) || 3));
  if (opts.pdf) return dictPdf(parts, title, { ...opts, cols });
  await guideWord(parts, title, { ...opts, cols, lines: false });
  return true;
}

// المعجمُ على صفحاتِ A4 حقيقيةٍ تُقاس وتُملأ بأيدينا (ملاحظتا ٢٧٤ و٢٨٠).
//   وغلافُه بشعار الهيئة متوسّطًا بلا اسمٍ مكتوب (ملاحظتا ٢٧٣ و٢٩٥)،
//   وظهرُه صفحةُ حقوقٍ وتعريف، وآخرُه فهرسُ الحروف.
const AUTHORITY_LOGO = '/assets/alharamain-logo-dark.png';

function dictPdf(parts, title, opts = {}) {
  const { note = '', cols = 3, letters = true, edition = '', about = true } = opts;
  const HEAD_H = 10;
  const W = boxWidth();
  const WIN = winHeight() - HEAD_H;
  const GAP = 6;
  const COL_W = (W - GAP * (cols - 1)) / cols;

  const ctx = openSheetWindow(sheetCss(`
  .cover { position: absolute; inset: 0; padding: 30mm 26mm 24mm; display: flex;
    flex-direction: column; align-items: center; text-align: center; }
  .cover img.logo { height: 30mm; margin-bottom: 16mm; }
  .cover h1 { font-size: 26pt; margin: 0; color: #1d2b3a; line-height: 1.4; }
  .cover .orn { display: block; width: 56mm; height: 11mm; margin: 8mm 0; }
  .cover .meta { font-size: 12pt; color: #4a5560; line-height: 2.1; }
  .cover .foot { margin-top: auto; font-size: 9pt; color: #6b6257; letter-spacing: .06em; }
  .colophon { position: absolute; top: ${PAGE.top}mm; inset-inline-start: ${PAGE.side}mm;
    width: ${W}mm; font-size: 10.5pt; line-height: 2; color: #3b3630; }
  .colophon h2 { font-size: 13pt; color: #1d2b3a; margin: 0 0 4mm;
    border-bottom: .4mm solid #c8b591; padding-bottom: 1.5mm; }
  .colophon p { margin: 0 0 4mm; }
  .colophon .rights { border: .3mm solid #e3d9c8; border-radius: 2mm; padding: 4mm;
    background: #fbf8f2; font-size: 10pt; }
  .runhead { position: absolute; top: ${PAGE.top - HEAD_H}mm; inset-inline-start: ${PAGE.side}mm;
    width: ${W}mm; height: ${HEAD_H}mm; display: flex; align-items: flex-end;
    justify-content: space-between; gap: 4mm; font-size: 8.5pt; color: #8a7a5c;
    border-bottom: .35mm solid #c8b591; padding-bottom: 1.2mm; }
  .runhead b { font-size: 9.5pt; color: #3b3630; direction: ltr; }
  .runhead span { max-width: 42%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .win.dict { top: ${PAGE.top}mm; height: ${WIN}mm; display: flex; gap: ${GAP}mm; }
  .col { width: ${COL_W}mm; overflow: hidden; }
  .col + .col { border-inline-start: .2mm solid #e3d9c8; padding-inline-start: ${GAP / 2}mm; }
  .ent { font-size: 8.5pt; line-height: 1.6; padding: .5mm 0; }
  .ent .ar { font-weight: 700; }
  .ent .sep { color: #9a8a6c; margin: 0 1mm; }
  .ent .tr { direction: auto; unicode-bidi: plaintext; }
  .lh-letter { margin: 2.5mm 0 1.2mm; text-align: center; font-size: 12pt; font-weight: 700;
    color: #b9975b; border-bottom: .3mm solid #e3d9c8; padding-bottom: .8mm; }
  .lang-head { font-size: 13pt; font-weight: 700; color: #1d2b3a; margin: 0 0 2mm;
    border-bottom: .4mm solid #c8b591; padding-bottom: 1mm; }
  .idx { font-size: 10pt; column-count: 3; column-gap: 8mm; }
  .idx div { padding: .6mm 0; }
  #measure { width: ${COL_W - GAP / 2}mm; }`));
  if (!ctx) return false;
  const { el, img, pages, measure, w } = ctx;

  const ORN = '<svg class="orn" viewBox="0 0 160 30" aria-hidden="true">'
    + '<line x1="0" y1="15" x2="60" y2="15" stroke="#b9975b" stroke-width="1"/>'
    + '<line x1="100" y1="15" x2="160" y2="15" stroke="#b9975b" stroke-width="1"/>'
    + '<g fill="none" stroke="#b9975b" stroke-width="1.2">'
    + '<rect x="71" y="6" width="18" height="18"/>'
    + '<rect x="71" y="6" width="18" height="18" transform="rotate(45 80 15)"/></g></svg>';

  ctx.ready(() => {
    const out = [];
    const total = parts.reduce((n, p) => n + p.pairs.length, 0);

    // ١) الغلاف: شعارُ الهيئة وحدَه متوسّطًا، بلا اسمٍ مكتوب
    const cover = el('div', 'sheet');
    const cw = el('div', 'cover');
    cw.append(img(AUTHORITY_LOGO, 'logo'));
    cw.append(el('h1', null, escapeHtml(title)));
    cw.insertAdjacentHTML('beforeend', ORN);
    const meta = el('div', 'meta');
    meta.append(el('div', null, escapeHtml(parts.map(p => p.name).join(' · '))));
    meta.append(el('div', null, `عدد المصطلحات: ${total}`));
    cw.append(meta);
    const foot = el('div', 'foot');
    foot.append(el('div', null, escapeHtml(fmtHijri(new Date()) + ' — ' + fmtDate(new Date()))));
    if (edition) foot.append(el('div', null, escapeHtml(edition)));
    cw.append(foot);
    cover.append(cw);
    out.push(cover);

    // ٢) ظهرُ الغلاف: الحقوقُ والتعريف
    if (about) {
      const back = el('div', 'sheet');
      back.append(img(LETTERHEAD));
      const bk = el('div', 'colophon');
      bk.append(el('h2', null, 'عن هذا الدليل'));
      bk.append(el('p', null,
        'دليلٌ مصطلحيٌّ موحَّد يصدر عن مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين: '
        + 'لكلِّ مصطلحٍ شرعيٍّ مقابلٌ واحدٌ معتمدٌ في كلِّ لغة، فلا يختلف المترجمون في لفظٍ '
        + 'شرعيٍّ واحد. والرجوع إليه إلزاميٌّ عند لبس المصطلح.'));
      bk.append(el('p', null,
        'ويُقرأ هكذا: المصطلحُ العربيُّ أوّلًا، ثم نقطتان، ثم مقابلُه في اللغة. '
        + 'والمداخلُ مرتَّبةٌ ترتيبًا معجميًّا بالجذر لا بـ«ال» التعريف، وتفصل بينها حروفُها.'));
      bk.append(el('p', null,
        'وما ظهر لك فيه معنًى أدقُّ فراسِلْ إدارة المشروع، فالدليلُ يُجوَّد بتعاون المترجمين.'));
      const rights = el('div', 'rights');
      rights.append(el('div', null,
        'جميعُ الحقوق محفوظة للهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي.'));
      rights.append(el('div', null,
        'لا يجوز نسخُ هذا الدليل أو نشرُه أو الاقتباسُ منه لغير أغراض المشروع إلا بإذنٍ خطّيّ.'));
      if (edition) rights.append(el('div', null, `رقمُ الإصدار: ${edition}`));
      bk.append(rights);
      back.append(bk);
      out.push(back);
    }

    const WIN_PX = mm2px(WIN);
    const idxAll = [];

    for (const part of parts) {
      const blocks = [{ kind: 'head',
        html: `<div class="lang-head">${escapeHtml(part.name)}`
            + ` <small style="font-weight:400;color:#7a8894">(${part.pairs.length})</small></div>` }];
      let last = null;
      for (const [a, b] of part.pairs) {
        if (letters) {
          const L = arLetter(a);
          if (L && L !== last) {
            last = L;
            blocks.push({ kind: 'letter', letter: L, keep: 22,
              html: `<div class="lh-letter">${escapeHtml(L)}</div>` });
          }
        }
        blocks.push({ kind: 'ent', ar: a,
          html: `<div class="ent"><span class="ar">${escapeHtml(a)}</span>`
              + `<span class="sep">:</span><span class="tr">${escapeHtml(b)}</span></div>` });
      }
      measureBlocks(w, measure, blocks);

      const sheets = [];
      let sheet = null, win = null, colNo = 0;
      const nextBox = () => {
        if (!sheet || colNo >= cols) {
          sheet = el('div', 'sheet');
          sheet.append(img(LETTERHEAD));
          win = el('div', 'win dict');
          sheet.append(win);
          sheets.push({ sheet, first: null, last: null });
          colNo = 0;
        }
        colNo += 1;
        const col = el('div', 'col');
        win.append(col);
        return col;
      };
      for (const b of blocks) {
        if (b.kind === 'ent') {
          b.onPlace = () => {
            const cur = sheets[sheets.length - 1];
            if (!cur.first) cur.first = b.ar;
            cur.last = b.ar;
          };
        } else if (b.kind === 'letter') {
          b.onPlace = () => idxAll.push([part.name, b.letter, out.length + sheets.length]);
        }
      }
      flowBlocks(blocks, WIN_PX, nextBox);

      sheets.forEach((s, i) => {
        const no = out.length + i + 1;
        if (s.first) {
          const head = el('div', 'runhead');
          head.append(el('span', null, escapeHtml(s.first)));
          head.append(el('b', null, String(no)));
          head.append(el('span', null, escapeHtml(s.last || s.first)));
          s.sheet.prepend(head);
        }
        s.sheet.append(el('div', 'pageno', String(no)));
      });
      out.push(...sheets.map(s => s.sheet));
    }

    // ٣) فهرسُ الحروف: الحرفُ ورقمُ صفحته (ملاحظة ٢٩٥ ز)
    if (letters && idxAll.length) {
      const sh = el('div', 'sheet');
      sh.append(img(LETTERHEAD));
      const win = el('div', 'win');
      win.append(el('h1', null, 'فهرسُ الحروف'));
      const box = el('div', 'idx');
      for (const [lang, L, pg] of idxAll) {
        box.append(el('div', null,
          `${escapeHtml(parts.length > 1 ? lang + ' — ' : '')}${escapeHtml(L)} … ${pg}`));
      }
      win.append(box);
      sh.append(win);
      sh.append(el('div', 'pageno', String(out.length + 1)));
      out.push(sh);
    }

    pages.replaceChildren(...out);
    measure.remove();
  });
  return true;
}
