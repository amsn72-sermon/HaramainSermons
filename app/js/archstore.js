// تصديرُ أرشيف الخطب للتخزين: مضغوطٌ مشجَّرٌ على الأعوام والأشهر
// واللغات (ملاحظتا ٣٨٣ و٣٨٥)
//
//   التصديرُ المفرَدُ يُخرِج خطبةً خطبة، والجماعيُّ بمدًى يُخرِجها في
//   ملفٍّ واحد. وأمّا التخزينُ فيُراد به أن تُحفَظ خطبُ الأعوام كلِّها
//   على القرص مرتَّبةً كما تُرتَّب في الخزانة: عامٌ ثمَّ شهرٌ ثمَّ لغةٌ
//   ثمَّ ملفٌّ باسمه.
//
//   وصيغتُه Word: فملفُّ Word يُبنى في المتصفح بايتًا بايتًا، فيُحزَم
//   كما هو. وأمّا PDF فلا يُولَّد في المتصفح إلا من نافذة الطباعة —
//   وهي نافذةٌ واحدةٌ في كلِّ مرة — فلا تُحزَم منه مئاتُ الملفات.
//   وهذا يُقال صراحةً في النافذة ولا يُوهَم خلافُه.
import { h, dialog, toast, fmtHijri } from './ui.js';
import { db } from './sb.js';
import { MOSQUE, langName } from './store.js';
import { zipFiles, downloadBlob } from './xlsx.js';
import { rowToItem } from './archexport.js';

const AR  = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

export const H_MONTHS = ['محرَّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى',
  'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];

// اسمُ ملفٍّ أو مجلَّدٍ يصلح لكلِّ نظام: لا شرطاتٍ مائلةً ولا محارفَ محجوزة
export const safeName = s => String(s || '')
  .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 110) || 'بلا اسم';

export const monthFolder = m => {
  const n = Math.min(12, Math.max(1, Number(m) || 1));
  return `${String(n).padStart(2, '0')} — ${H_MONTHS[n - 1]}`;
};

// اسمُ ملفِّ الخطبة: جمعتُها وعنوانُها وخطيبُها، كما طُلب (ملاحظة ٣٨٣)
export function sermonFileName(r) {
  const when = r.hijri_text || (r.sermon_date ? fmtHijri(r.sermon_date) : '');
  return safeName([
    r.sermon_type || 'خطبة',
    when,
    r.title || '',
    r.khateeb || '',
    r.doc_no || ''
  ].filter(Boolean).join(' — '));
}

export async function storeDialog(preYear = null) {
  let years = [];
  try { years = await db.rpc('arch_export_years') || []; } catch { years = []; }
  years = years.filter(y => Number(y.versions) > 0);
  if (!years.length) return toast('لا نسخَ محفوظةٌ في الأرشيف بعد.', 'bad');

  const boxes = years.map(y => {
    const i = h('input', { type: 'checkbox',
      checked: (!preYear || Number(preYear) === Number(y.h_year)) ? true : null,
      'aria-label': `عام ${y.h_year}` });
    return { y, i, el: h('label.check', i,
      h('span', `${ARY(y.h_year)}هـ — ${AR(y.sermons)} خطبة · ${AR(y.versions)} نسخة`)) };
  });
  const mosque = h('select', { 'aria-label': 'المسجد' },
    h('option', { value: '' }, 'الحرمان معًا'),
    Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v)));
  const fmt = h('select', { 'aria-label': 'الصيغة' },
    h('option', { value: 'docx', selected: true }, 'Word — على كليشة الهيئة'),
    h('option', { value: 'pdf' }, 'PDF — على الكليشة'));
  const note = h('p.small.warn', { hidden: true });
  fmt.onchange = () => {
    note.hidden = fmt.value !== 'pdf';
    note.textContent = 'ملفُّ PDF لا يُولَّد في المتصفح إلا من نافذة الطباعة، '
      + 'وهي واحدةٌ في كلِّ مرّة — فلا تُحزَم منه مئاتُ الملفات. '
      + 'والمضغوطُ يخرج Word، وما أردتَه PDF فمن «تصديرٌ بمدى» أو من صفِّ الخطبة.';
  };

  const res = await dialog({
    title: 'تصديرُ الأرشيف للتخزين',
    body: h('div.stack',
      h('p.small.muted', 'يخرج ملفٌّ مضغوطٌ واحد: مجلَّدٌ لكلِّ عام، وفيه مجلَّدٌ لكلِّ شهر، وفيه مجلَّدٌ لكلِّ لغة، وفيه ملفاتُ الخطب على كليشة الهيئة.'),
      h('fieldset.stack', h('legend', 'الأعوام'),
        h('div.check-grid', boxes.map(b => b.el))),
      h('div.grid-2',
        h('label.field', 'المسجد', mosque),
        h('label.field', 'الصيغة', fmt)),
      note),
    buttons: [{ label: 'صدِّرْ للتخزين', kind: 'primary',
      validate: () => (boxes.some(b => b.i.checked) ? true : 'اختر عامًا واحدًا على الأقل'),
      value: () => ({ years: boxes.filter(b => b.i.checked).map(b => Number(b.y.h_year)),
        mosque: mosque.value || null, fmt: fmt.value }) },
      { label: 'إلغاء', value: null }]
  });
  if (!res) return;
  return buildStoreZip(res);
}

// البناءُ نفسُه — مفصولٌ ليُختبَر وحدَه
export async function buildStoreZip({ years, mosque = null, onStep = null }) {
  const { docxBlob } = await import('./export.js');
  const entries = [];
  const root = 'أرشيف الخطب';
  let made = 0, skipped = 0;

  for (const year of years) {
    let langs = [];
    try { langs = await db.rpc('arch_year_langs', { p_year: year }) || []; } catch { langs = []; }
    for (const l of langs) {
      let rows = [];
      try {
        rows = await db.rpc('arch_book', { p_year: year, p_lang: l.code,
          p_mosque: mosque, p_section: null, p_from: null, p_to: null }) || [];
      } catch { rows = []; }
      for (const r of rows) {
        if (!r.body_html) { skipped++; continue; }
        const dir = `${root}/${ARY(year)}هـ/${monthFolder(r.h_month)}/${safeName(l.name_ar)}`;
        const item = rowToItem(r, l.code);
        try {
          const blob = await docxBlob([item], { name: sermonFileName(r) });
          entries.push([`${dir}/${sermonFileName(r)}.docx`,
            new Uint8Array(await blob.arrayBuffer())]);
          made++;
          if (onStep) onStep({ year, lang: l.code, made, skipped });
        } catch { skipped++; }
      }
    }
  }

  if (!entries.length) {
    toast('لا نصوصَ محفوظةٌ في هذه الأعوام — ولا يُحزَم ما لا نصَّ له.', 'bad');
    return null;
  }
  // ورقةُ بيانٍ في جذر المضغوط: ما فيه ومتى أُخرج
  entries.unshift([`${root}/بيانُ التصدير.txt`,
    `أرشيفُ خطب الحرمين — تصديرٌ للتخزين\n`
    + `الأعوام: ${years.map(y => `${ARY(y)}هـ`).join('، ')}\n`
    + `المسجد: ${mosque ? MOSQUE[mosque] : 'الحرمان معًا'}\n`
    + `عددُ الملفات: ${AR(made)}\n`
    + `ما لا نصَّ له فلم يُحزَم: ${AR(skipped)}\n`
    + `أُخرج في: ${new Date().toLocaleString('ar-SA-u-nu-latn')}\n`]);

  const name = years.length === 1
    ? `أرشيف خطب ${ARY(years[0])}هـ`
    : `أرشيف الخطب — ${AR(years.length)} أعوام`;
  downloadBlob(zipFiles(entries), `${name}.zip`);
  toast(`حُزم ${AR(made)} ملفًا` + (skipped ? ` · تُرك ${AR(skipped)} بلا نصّ.` : '.'), 'ok');
  return { made, skipped, files: entries.length };
}

// زرٌّ جاهزٌ لصفحة الأعوام
export function storeButton() {
  const b = h('button.btn.sm', { type: 'button',
    title: 'مضغوطٌ مشجَّرٌ: عامٌ ← شهرٌ ← لغةٌ ← ملفاتُ الخطب' }, '🗄 تصديرٌ للتخزين');
  b.onclick = () => storeDialog();
  return b;
}

export const langFolder = l => safeName(langName(l) || l);
