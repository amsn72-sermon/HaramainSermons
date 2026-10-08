// التصديرُ الجماعيُّ من صفحة العام: Word وPDF على الكليشة، وPDF على
// قالبٍ مختارٍ من المصمِّم — بحدودٍ تُطلَب قبلَه (ملاحظة ٣٧١)
//
//   كان التصديرُ خطبةً خطبةً من صفِّها، فإذا أُريد ربعُ العام بلغةٍ
//   واحدةٍ كان خمسًا وعشرين نقرة. فصار يُطلَب المدى واللغةُ والمسجدُ
//   مرّةً، ويخرج الكلُّ في ملفٍّ واحد.
import { h, dialog, toast, busy, fmtHijri, fmtDate } from './ui.js';
import { db } from './sb.js';
import { MOSQUE, langName } from './store.js';

const AR  = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

// صفُّ arch_book ← ما يفهمه المُصدِّر: مادةٌ ومسارُ لغة
export function rowToItem(r, lang) {
  return {
    material: {
      id: r.doc_no || `${r.week_no}:${r.mosque}`,
      title: r.title || '—',
      material_type: 'خطب',
      sermon_type: r.sermon_type || 'خطبة جمعة',
      mosque: r.mosque || null,
      sermon_date: r.sermon_date || null,
      khateeb: r.khateeb ? { name: r.khateeb } : null,
    },
    track: {
      id: `${r.doc_no || r.week_no}:${lang}`,
      language_code: lang,
      translation_html: r.body_html || '',
      title_tr: r.title_tr || null,
      doc_no: r.doc_no || null,
      doc_no_at: r.sermon_date || null,
      completed_at: r.sermon_date || null,
    },
    khateeb: r.khateeb || null,
  };
}

export async function rangeExportDialog(year, section, preset = {}) {
  let langs = [];
  try { langs = await db.rpc('arch_book_langs', { p_year: year }) || []; } catch { langs = []; }
  if (!langs.length) return toast('لا نسخَ في هذا العام بعد.', 'bad');

  let saved = [];
  try { saved = await db.rpc('book_templates_list') || []; } catch { saved = []; }

  const fmt = h('select', { 'aria-label': 'الصيغة' },
    h('option', { value: 'docx' }, 'Word — على كليشة الهيئة'),
    h('option', { value: 'pdf', selected: true }, 'PDF — على كليشة الهيئة'),
    h('option', { value: 'book' }, 'PDF — على قالبٍ مختار'));
  const lang = h('select', { 'aria-label': 'اللغة' },
    langs.map(l => h('option', { value: l.language_code }, `${l.name_ar} (${AR(l.n)} خطبة)`)));
  const mosque = h('select', { 'aria-label': 'المسجد' },
    h('option', { value: '' }, 'الحرمان معًا'),
    Object.entries(MOSQUE).map(([k, v]) =>
      h('option', { value: k, selected: preset.mosque === k }, v)));
  const from = h('input', { type: 'date', 'aria-label': 'من تاريخ', value: preset.from || '' });
  const to   = h('input', { type: 'date', 'aria-label': 'إلى تاريخ', value: preset.to || '' });
  const tplSel = h('select', { 'aria-label': 'القالب' },
    saved.length
      ? saved.map(r => h('option', { value: r.id,
          selected: r.h_year === year || (!saved.some(x => x.h_year === year) && r.is_default) },
          `${r.name}${r.is_default ? ' ★' : ''}${r.h_year ? ` — ${ARY(r.h_year)}هـ` : ''}`))
      : [h('option', { value: '' }, 'القالبُ الافتراضي')]);
  const tplRow = h('div.row.between.wrap',
    h('label.field', { style: { flex: 1, minWidth: '220px' } }, 'القالب', tplSel),
    h('a.btn.sm', { href: '/app/book-design' }, '🖌 تصميمُ القوالب'));
  const sync = () => { tplRow.hidden = fmt.value !== 'book'; };
  fmt.onchange = sync; sync();

  const res = await dialog({
    title: `تصديرُ خطب ${ARY(year)}هـ`,
    body: h('div.stack',
      h('p.small.muted', 'يُصدَّر ما بين التاريخين من خطب العام بلغةٍ واحدة، '
        + 'كلُّ خطبةٍ تبدأ صفحةً جديدة. واتركِ التاريخين فارغين ليخرج العامُ كلُّه.'),
      h('div.grid-2',
        h('label.field', 'الصيغة', fmt),
        h('label.field', 'اللغة', lang),
        h('label.field', 'المسجد', mosque),
        h('label.field', 'من تاريخ', from),
        h('label.field', 'إلى تاريخ', to)),
      tplRow),
    buttons: [
      { label: 'صدِّرْ', kind: 'primary',
        validate: () => ((from.value && to.value && from.value > to.value)
          ? 'التاريخُ الأول بعد الثاني' : true),
        value: () => ({ fmt: fmt.value, lang: lang.value, mosque: mosque.value || null,
          from: from.value || null, to: to.value || null, tpl: tplSel.value || null }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return;

  let rows = [];
  try {
    rows = await db.rpc('arch_book', { p_year: year, p_lang: res.lang,
      p_mosque: res.mosque, p_section: section ? section.id : null,
      p_from: res.from, p_to: res.to }) || [];
  } catch (e) { return toast(e.message, 'bad'); }
  if (!rows.length) return toast('لا خطبَ في هذا المدى.', 'bad');

  const span = [res.from ? fmtDate(res.from) : null, res.to ? fmtDate(res.to) : null]
    .filter(Boolean).join(' — ');
  const name = `خطب ${ARY(year)}هـ · ${langName(res.lang) || res.lang}`
    + (res.mosque ? ` · ${MOSQUE[res.mosque]}` : '') + (span ? ` · ${span}` : '');

  if (res.fmt === 'book') {
    const { buildBook, DEFAULT_TPL } = await import('./sermonbook.js');
    const chosen = saved.find(r => String(r.id) === String(res.tpl));
    const base = DEFAULT_TPL();
    const tpl = chosen?.tpl
      ? { ...base, ...chosen.tpl,
          cover:   { ...base.cover,   ...(chosen.tpl.cover   || {}) },
          divider: { ...base.divider, ...(chosen.tpl.divider || {}) },
          inner:   { ...base.inner,   ...(chosen.tpl.inner   || {}) } }
      : base;
    if (!buildBook(rows, { year, lang: res.lang, title: name, intro: tpl.intro || '', tpl })) {
      toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
    }
    return;
  }

  const items = rows.filter(r => r.body_html).map(r => rowToItem(r, res.lang));
  if (!items.length) return toast('لا نصَّ محفوظٌ في خطب هذا المدى.', 'bad');

  if (res.fmt === 'docx') {
    const { downloadDocxBundle } = await import('./export.js');
    try { await downloadDocxBundle(items, { name }); }
    catch (e) { toast(e.message, 'bad'); }
    return;
  }
  const { printTranslations } = await import('./export.js');
  if (!printTranslations(items, { autoPrint: false, name })) {
    toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
  }
}

// زرٌّ جاهزٌ يُركَّب في رأس الصفحة
export function exportButton(year, section) {
  const b = h('button.btn.sm', { type: 'button',
    title: 'Word أو PDF على الكليشة أو على قالب — بمدًى ولغةٍ ومسجد' }, '⤓ تصديرٌ بمدى');
  b.onclick = () => busy(b, () => rangeExportDialog(year, typeof section === 'function' ? section() : section));
  return b;
}

export const spanLabel = (a, b) =>
  [a ? fmtHijri(a) : null, b ? fmtHijri(b) : null].filter(Boolean).join(' — ');
