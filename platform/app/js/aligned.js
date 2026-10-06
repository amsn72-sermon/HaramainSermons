// التصديرُ المقابِل: الأصلُ وتحتَه ترجمتُه (ملاحظة ٢٥٢)
//   يُقابَل بالفقرة أو بالجملة. والفقرةُ أمتن: الجملةُ العربيةُ تُعطَف
//   بالواو فتطول، فيقطعها المترجمُ جملتين — وذلك صوابٌ لا خطأ. أمّا
//   الفقرةُ فوحدةُ معنًى لا تُفكَّك إلا نادرًا.
//
//   والمحاذاةُ تُصنع بالترتيب: الأولُ إلى الأول. فإن اختلف العددُ نبّهنا
//   عليه ولم نُخفِه، وتُعرض الزيادةُ في جهتها فلا يضيع نص.
import { h, escapeHtml, fmtDate } from './ui.js';
import { PAGE, LETTERHEAD } from './page.js';
import { buildXlsxBook, downloadBlob } from './xlsx.js';
import { openSheetWindow, measureBlocks, flowBlocks, mm2px, sheetCss, winHeight } from './sheetflow.js';
import { langName, langDir } from './store.js';

const BLOCK = /<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi;

// HTML ← فقرات: الوسومُ الكتليّةُ فواصل، والفراغُ المكرَّرُ فاصلٌ كذلك
export function toParagraphs(html) {
  const marked = String(html || '').replace(BLOCK, '\u0000').replace(/<br\s*\/?>/gi, '\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = marked;
  const text = tmp.textContent || '';
  return text.split(/[\u0000\n]{1,}/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// فقرة ← جمل: علاماتُ الوقف في العربية وفي اللاتينية
export function toSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?؟।。])\s+|(?<=[؛])\s+/u)
    .map(s => s.trim())
    .filter(Boolean);
}

export function splitUnits(html, mode) {
  const paras = toParagraphs(html);
  if (mode !== 'sentence') return paras;
  return paras.flatMap(p => toSentences(p));
}

// محاذاةٌ بالترتيب، وما زاد يبقى في جهته
export function alignPairs(srcHtml, trHtml, mode) {
  const a = splitUnits(srcHtml, mode);
  const b = splitUnits(trHtml, mode);
  const n = Math.max(a.length, b.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push([a[i] || '', b[i] || '']);
  return { pairs, srcCount: a.length, trCount: b.length, drift: a.length !== b.length };
}

const STAMP = () => new Date().toISOString().slice(0, 10);
const safe = s => String(s || 'عمل').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) || 'عمل';

// ---------------------------------------------------------------------
// الصيغ الثلاث
// ---------------------------------------------------------------------
export function alignedXlsx(work, parts, mode) {
  // ورقةٌ لكلِّ لغة: عمودُ الأصلِ وعمودُ الترجمة
  const sheets = parts.map(p => ({
    name: langName(p.code),
    rows: [['#', 'الأصل العربي', langName(p.code)],
      ...p.pairs.map((pr, i) => [String(i + 1), pr[0], pr[1]])]
  }));
  downloadBlob(buildXlsxBook(sheets, { allText: true }),
    `${safe(work.title)} — مقابل ${mode === 'sentence' ? 'جملةً بجملة' : 'فقرةً بفقرة'}.xlsx`);
}

// المقابلةُ على صفحاتِ A4 حقيقيةٍ: تُقاس الأزواجُ وتُوزَّع، ولكلِّ
// صفحةٍ كليشتُها ورقمُها، فلا يفيض الجدولُ على الكليشة (ملاحظة ٢٧٤)
export function alignedPdf(work, parts, mode, note = '') {
  const unit = mode === 'sentence' ? 'جملةً بجملة' : 'فقرةً بفقرة';

  const ctx = openSheetWindow(sheetCss(`
  h2 { font-size: 11.5pt; margin: 0 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #c8b591; }
  .warn { font-size: 8.5pt; color: #8a5a00; background: #fff6e5; border: 1px solid #e8d3a8;
          border-radius: 2mm; padding: 1.5mm 2mm; margin: 0 0 3mm; }
  .pair { display: grid; grid-template-columns: 8mm 1fr; gap: 0 2mm;
          padding: 1.5mm 0; border-bottom: 1px dotted #ddd2bd; }
  .n { grid-row: span 2; font-size: 7.5pt; color: #9aa6b1; padding-top: .6mm; }
  .ar { font-size: 10pt; font-weight: 600; line-height: 1.7; }
  .tr { font-size: 9.5pt; color: #2c3b48; line-height: 1.7; unicode-bidi: plaintext; }
  .gap { color: #b3261e; font-size: 8pt; }`));
  if (!ctx) return false;
  const { el, pages, measure, w } = ctx;

  ctx.ready(() => {
    const blocks = [
      { html: `<h1>${escapeHtml(work.title || 'عمل')}</h1>` },
      { html: `<p class="sub">${escapeHtml(note || `${unit} — ${fmtDate(new Date())}`)}</p>` }
    ];
    for (const p of parts) {
      blocks.push({ keep: 40, html: `<h2>${escapeHtml(langName(p.code))}</h2>` });
      if (p.drift) {
        blocks.push({ html: `<p class="warn">تنبيه: الأصل ${p.srcCount} والترجمة ${p.trCount}`
          + ' — والمحاذاةُ بالترتيب، فراجِعْ ما بعد موضع الاختلاف.</p>' });
      }
      p.pairs.forEach((pr, i) => blocks.push({ html: '<div class="pair">'
        + `<div class="n">${i + 1}</div>`
        + `<div class="ar" dir="rtl">${escapeHtml(pr[0]) || '<span class="gap">— لا مقابل في الأصل —</span>'}</div>`
        + `<div class="tr" dir="${langDir(p.code)}">${escapeHtml(pr[1]) || '<span class="gap">— لم تُترجم —</span>'}</div>`
        + '</div>' }));
    }
    measureBlocks(w, measure, blocks);

    const sheets = [];
    const nextBox = () => {
      const { sheet, win } = ctx.sheet();
      sheets.push(sheet);
      return win;
    };
    flowBlocks(blocks, mm2px(winHeight()), nextBox);

    sheets.forEach((sh, i) => sh.append(el('div', 'pageno', `${i + 1} / ${sheets.length}`)));
    pages.replaceChildren(...sheets);
    measure.remove();
  });
  return true;
}

export async function alignedWord(work, parts, mode, note = '') {
  const { loadDocx } = await import('./export.js');
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
    AlignmentType, WidthType, HeadingLevel, BorderStyle } = docx;

  const unit = mode === 'sentence' ? 'جملةً بجملة' : 'فقرةً بفقرة';
  const b = { style: BorderStyle.SINGLE, size: 2, color: 'DDD2BD' };
  const cell = (children, width) => new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    borders: { top: b, bottom: b, left: b, right: b },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children
  });
  const line = (text, o = {}) => new Paragraph({ bidirectional: true,
    children: [new TextRun({ text: String(text || ''), rightToLeft: true, size: 20, ...o })] });

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: work.title || 'عمل', bold: true, rightToLeft: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true,
      children: [new TextRun({ text: note || `${unit} — ${fmtDate(new Date())}`, rightToLeft: true, size: 18 })] }),
    new Paragraph({ text: '' })
  ];

  for (const p of parts) {
    children.push(new Paragraph({ bidirectional: true, heading: HeadingLevel.HEADING_3,
      children: [new TextRun({ text: langName(p.code), bold: true, rightToLeft: true })] }));
    if (p.drift) {
      children.push(line(`تنبيه: الأصل ${p.srcCount} والترجمة ${p.trCount} — المحاذاةُ بالترتيب.`,
        { size: 16, color: '8A5A00' }));
    }
    const rows = p.pairs.map((pr, i) => new TableRow({ children: [
      cell([new Paragraph({ bidirectional: true,
        children: [new TextRun({ text: String(i + 1), size: 14, color: '9AA6B1' })] })], 6),
      cell([line(pr[0] || '— لا مقابل في الأصل —', { bold: true }),
        new Paragraph({ bidirectional: true,
          children: [new TextRun({ text: pr[1] || '— لم تُترجم —', size: 19 })] })], 94)
    ] }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: true, rows }));
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({ sections: [{
    properties: { page: { size: { width: `${PAGE.w}mm`, height: `${PAGE.h}mm` },
      margin: { top: `${PAGE.top}mm`, bottom: `${PAGE.bottom}mm`, left: `${PAGE.side}mm`, right: `${PAGE.side}mm` } } },
    children
  }] });
  downloadBlob(await Packer.toBlob(doc), `${safe(work.title)} — مقابل ${unit} ${STAMP()}.docx`);
}

// نافذةُ الخيارات ثم التصدير
// work: { title, source_html }، tracks: [{ language_code, translation_html }]
export async function exportAligned(work, tracks, { dialog, h: hh } = {}) {
  const avail = (tracks || []).filter(t => t.translation_html);
  if (!avail.length) return { ok: false, why: 'لا ترجمةً في هذا العمل بعد.' };

  const boxes = avail.map(t => {
    const cb = h('input', { type: 'checkbox', value: t.language_code, checked: true,
      'aria-label': langName(t.language_code) });
    return { code: t.language_code, cb, track: t,
      el: h('label.check.col-pick', cb, h('span', langName(t.language_code))) };
  });
  const modeSel = h('select', { 'aria-label': 'وحدة المقابلة' },
    h('option', { value: 'paragraph' }, 'فقرةً بفقرة — الأمتن'),
    h('option', { value: 'sentence' }, 'جملةً بجملة — الأدقّ حين تستقيم'));
  const fmtSel = h('select', { 'aria-label': 'الصيغة' },
    h('option', { value: 'docx' }, 'Word — مستند'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'),
    h('option', { value: 'xlsx' }, 'Excel — عمودان'));

  const preview = h('p.small.muted');
  const paint = () => {
    const mode = modeSel.value;
    const lines = boxes.filter(x => x.cb.checked).map(x => {
      const a = alignPairs(work.source_html, x.track.translation_html, mode);
      return `${langName(x.code)}: الأصل ${a.srcCount} والترجمة ${a.trCount}${a.drift ? ' ⚠' : ' ✓'}`;
    });
    preview.textContent = lines.join(' · ') || 'اختر لغةً واحدةً على الأقل.';
  };
  modeSel.addEventListener('change', paint);
  boxes.forEach(x => x.cb.addEventListener('change', paint));
  paint();

  const res = await dialog({
    title: 'تصديرٌ مقابِل — الأصلُ وترجمتُه',
    body: h('div.stack',
      h('p.small.muted', 'يخرج العملُ مقطعًا بمقطع: الأصلُ العربيُّ ثم ترجمتُه تحتَه. '
        + 'والفقرةُ أمتنُ من الجملة، فالمترجمُ يقسم الجملةَ الطويلةَ ولا يقسم الفقرة.'),
      h('fieldset.stack', h('legend', 'اللغات'), h('div.col-picker', boxes.map(x => x.el))),
      h('div.grid-2',
        h('label.field', 'وحدة المقابلة', modeSel),
        h('label.field', 'الصيغة', fmtSel)),
      preview,
      h('p.small.muted', 'وعلامةُ ⚠ تعني اختلافَ العدد بين الأصل والترجمة — '
        + 'فالمحاذاةُ بالترتيب، وما بعد موضع الاختلاف يحتاج نظرًا.')),
    buttons: [
      { label: 'صدّر', kind: 'primary',
        validate: () => (boxes.some(x => x.cb.checked) ? true : 'اختر لغةً واحدةً على الأقل'),
        value: () => ({ codes: boxes.filter(x => x.cb.checked).map(x => x.code),
          mode: modeSel.value, fmt: fmtSel.value }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return { ok: false };

  const parts = res.codes.map(code => {
    const t = avail.find(x => x.language_code === code);
    const a = alignPairs(work.source_html, t.translation_html, res.mode);
    return { code, ...a };
  });

  if (res.fmt === 'xlsx') { alignedXlsx(work, parts, res.mode); return { ok: true }; }
  if (res.fmt === 'pdf') {
    return { ok: alignedPdf(work, parts, res.mode), why: 'اسمح بالنوافذ المنبثقة للطباعة.' };
  }
  await alignedWord(work, parts, res.mode);
  return { ok: true };
}
