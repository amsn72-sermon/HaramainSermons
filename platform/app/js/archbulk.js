// التصديرُ المجمَّع من صفحة الأرشيف (ملاحظة ٤١٣)
//
//   المدةُ عامٌ أو شهر، واللغاتُ تُختار، وترتيبُ المخرَج إمّا كلُّ جمعةٍ
//   على حدةٍ — العربيةُ ثمَّ لغاتُها تحتها — وإمّا لغاتٌ محدَّدةٌ وحدَها.
//   ويُقال عددُ الخطب والصفحاتِ قبل البناء، ويُختار ما يُصدَّر عليه:
//   قالبُ مجمَّعٍ أو كليشة.
import { h, dialog, toast, busy } from './ui.js';
import { db } from './sb.js';
import { MOSQUE, langName } from './store.js';
import { rowToItem } from './archexport.js';

const AR  = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

export const H_MONTHS = ['محرَّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى',
  'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوَّال', 'ذو القعدة', 'ذو الحجة'];

export async function bulkDialog(year, section) {
  // من صفحة الأعوام يُسأل عن العام أولًا (ملاحظة ٤١٣)
  if (!year) {
    let years = [];
    try { years = await db.rpc('arch_export_years') || []; } catch { years = []; }
    years = years.filter(y => Number(y.versions) > 0);
    if (!years.length) return toast('لا خطبَ في الأرشيف بعد.', 'bad');
    if (years.length === 1) year = Number(years[0].h_year);
    else {
      const sel = h('select', { 'aria-label': 'العام' },
        years.map(y => h('option', { value: String(y.h_year) },
          `${ARY(y.h_year)}هـ — ${AR(y.sermons)} خطبة`)));
      const pick = await dialog({
        title: 'التصديرُ المجمَّع',
        body: h('div.stack', h('label.field', 'العام', sel)),
        buttons: [{ label: 'تابِعْ', kind: 'primary', value: () => sel.value },
                  { label: 'إلغاء', value: null }]
      });
      if (!pick) return;
      year = Number(pick);
    }
  }
  const [langRows, tplRows] = await Promise.all([
    db.rpc('arch_book_langs', { p_year: year }).catch(() => []),
    db.rpc('export_templates').catch(() => [])
  ]);
  if (!langRows.length) return toast('لا نسخَ في هذا العام بعد.', 'bad');

  // ـــ اللغات: كلُّ لغةٍ مربّعٌ يُؤشَّر
  const boxes = langRows.map(l => {
    const cb = h('input', { type: 'checkbox', checked: true, value: l.language_code,
      'aria-label': l.name_ar });
    return { code: l.language_code, cb,
      el: h('label.check.bulk-lang', cb,
        h('span', l.name_ar, h('span.small.muted', ` ${AR(l.n)}`))) };
  });
  const picked = () => boxes.filter(b => b.cb.checked).map(b => b.code);

  const allBtn = h('button.btn.xs.ghost', { type: 'button' }, 'الكلُّ');
  const noneBtn = h('button.btn.xs.ghost', { type: 'button' }, 'لا شيء');
  const arBtn = h('button.btn.xs.ghost', { type: 'button' }, 'العربيةُ وحدَها');

  const month = h('select', { 'aria-label': 'الشهر' },
    h('option', { value: '' }, 'العامُ كلُّه'),
    H_MONTHS.map((m, i) => h('option', { value: String(i + 1) },
      `الشهرُ ${AR(i + 1)} — ${m}`)));
  const mosque = h('select', { 'aria-label': 'المسجد' },
    h('option', { value: '' }, 'الحرمان معًا'),
    Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v)));

  // ـــ ترتيبُ المخرَج
  const order = h('select', { 'aria-label': 'ترتيب المخرج' },
    h('option', { value: 'friday' }, 'كلُّ جمعةٍ على حدةٍ — العربيةُ ثمَّ لغاتُها'),
    h('option', { value: 'lang' }, 'لغاتٌ محدَّدةٌ وحدَها، كلُّ لغةٍ على حدة'));

  const lhs = (tplRows || []).filter(r => r.kind === 'letterhead');
  const books = (tplRows || []).filter(r => r.kind === 'book');
  const tpl = h('select', { 'aria-label': 'ما يُصدَّر عليه' },
    h('option', { value: 'official' }, 'كليشةُ الهيئة'),
    lhs.length ? h('optgroup', { label: 'الكليشات' },
      lhs.map(r => h('option', { value: `lh:${r.id}` },
        r.name + (r.is_default ? ' — الأصل' : '')))) : null,
    books.length ? h('optgroup', { label: 'قوالبُ المجمَّع' },
      books.map(r => h('option', { value: `book:${r.id}` }, r.name))) : null);

  const fmt = h('select', { 'aria-label': 'الصيغة' },
    h('option', { value: 'pdf' }, 'PDF — للمعاينة والطباعة'),
    h('option', { value: 'docx' }, 'Word'));

  // ـــ العدَّادُ: خطبٌ ونسخٌ وتقديرُ صفحات، يُحدَّث مع كلِّ تغيير
  const count = h('p.small.muted.bulk-count', 'يُحسَب…');
  let timer = null;
  const recount = () => {
    clearTimeout(timer);
    count.textContent = 'يُحسَب…';
    timer = setTimeout(async () => {
      const codes = picked();
      if (!codes.length) { count.textContent = 'لم تُختَرْ لغة.'; return; }
      try {
        const r = await db.rpc('arch_export_count', {
          p_year: year, p_langs: codes, p_month: month.value ? Number(month.value) : null,
          p_mosque: mosque.value || null, p_section: section ? section.id : null });
        const row = (Array.isArray(r) ? r[0] : r) || {};
        count.textContent = `${AR(row.sermons)} خطبة · ${AR(row.versions)} نسخة · `
          + `نحوُ ${AR(row.pages)} صفحة`;
      } catch (e) { count.textContent = e.message; }
    }, 220);
  };
  allBtn.onclick = () => { boxes.forEach(b => { b.cb.checked = true; }); recount(); };
  noneBtn.onclick = () => { boxes.forEach(b => { b.cb.checked = false; }); recount(); };
  arBtn.onclick = () => {
    boxes.forEach(b => { b.cb.checked = b.code === 'ar'; });
    recount();
  };
  boxes.forEach(b => b.cb.addEventListener('change', recount));
  [month, mosque].forEach(el => el.addEventListener('change', recount));
  recount();

  const res = await dialog({
    title: `التصديرُ المجمَّع — ${ARY(year)}هـ`,
    body: h('div.stack',
      h('div.grid-2',
        h('label.field', 'المدة', month),
        h('label.field', 'المسجد', mosque),
        h('label.field', 'ترتيبُ المخرَج', order),
        h('label.field', 'الصيغة', fmt)),
      h('label.field', 'ما يُصدَّر عليه', tpl),
      h('div.stack.tight',
        h('div.row.between', h('b.small', 'اللغات'),
          h('div.row.tight', allBtn, arBtn, noneBtn)),
        h('div.bulk-langs', ...boxes.map(b => b.el))),
      count),
    buttons: [
      { label: 'صدِّرْ', kind: 'primary',
        validate: () => (picked().length ? true : 'اختَرْ لغةً واحدةً على الأقلّ'),
        value: () => ({ langs: picked(), month: month.value ? Number(month.value) : null,
          mosque: mosque.value || null, order: order.value, tpl: tpl.value, fmt: fmt.value }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return;
  return runBulk(year, section, res);
}

async function runBulk(year, section, res) {
  let rows = [];
  try {
    rows = await db.rpc('arch_book_all', {
      p_year: year, p_langs: res.langs, p_month: res.month,
      p_mosque: res.mosque, p_section: section ? section.id : null }) || [];
  } catch (e) { return toast(e.message, 'bad'); }
  rows = rows.filter(r => r.body_html);
  if (!rows.length) return toast('لا نصَّ محفوظٌ فيما اخترتَ.', 'bad');

  // الترتيب: الجمعةُ أولًا ثمَّ لغاتُها، أو اللغةُ أولًا ثمَّ جُمَعُها
  let items;
  if (res.order === 'friday') {
    items = rows.map(r => rowToItem(r, r.language_code));
  } else {
    const byLang = [];
    for (const code of res.langs) {
      for (const r of rows) if (r.language_code === code) byLang.push(rowToItem(r, code));
    }
    items = byLang;
  }

  const monthName = res.month ? ` · ${H_MONTHS[res.month - 1]}` : '';
  const name = `خطب ${ARY(year)}هـ${monthName}`
    + (res.mosque ? ` · ${MOSQUE[res.mosque]}` : '')
    + (res.langs.length === 1 ? ` · ${langName(res.langs[0]) || res.langs[0]}` : '');

  // قالبُ المجمَّع: يُبنى كتابًا لا صفحاتٍ على كليشة
  if (res.tpl.startsWith('book:')) {
    const { buildBook, DEFAULT_TPL } = await import('./sermonbook.js');
    let saved = [];
    try { saved = await db.rpc('book_templates_list') || []; } catch { saved = []; }
    const chosen = saved.find(r => String(r.id) === res.tpl.slice(5));
    const base = DEFAULT_TPL();
    const t = chosen?.tpl
      ? { ...base, ...chosen.tpl,
          cover:   { ...base.cover,   ...(chosen.tpl.cover   || {}) },
          divider: { ...base.divider, ...(chosen.tpl.divider || {}) },
          inner:   { ...base.inner,   ...(chosen.tpl.inner   || {}) } }
      : base;
    const lang = res.langs.length === 1 ? res.langs[0] : 'ar';
    if (!buildBook(rows.filter(r => r.language_code === lang || res.langs.length > 1),
      { year, lang, title: name, intro: t.intro || '', tpl: t })) {
      toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
    }
    return;
  }

  if (res.fmt === 'docx') {
    const { downloadDocxBundle } = await import('./export.js');
    try { await downloadDocxBundle(items, { name }); }
    catch (e) { toast(e.message, 'bad'); }
    return;
  }

  let lh = null;
  if (res.tpl.startsWith('lh:')) {
    const m = await import('./letterhead.js');
    lh = await m.lhForPrint(res.tpl.slice(3));
  }
  const { printTranslations } = await import('./export.js');
  if (!printTranslations(items, { autoPrint: false, name, lh })) {
    toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
  }
}

// زرٌّ جاهزٌ يُركَّب في رأس صفحة الأرشيف
export function bulkButton(year, section) {
  const b = h('button.btn.sm.primary', { type: 'button',
    title: 'عامٌ أو شهرٌ، ولغاتٌ، وترتيبٌ، وقالبٌ أو كليشة' }, '⤓ تصديرٌ مجمَّع');
  b.onclick = () => busy(b, () =>
    bulkDialog(year, typeof section === 'function' ? section() : section));
  return b;
}
