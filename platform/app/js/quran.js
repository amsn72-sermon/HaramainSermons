// إدراجُ الآيات بالرسم العثمانيِّ من مصحف المنصة (ملاحظة ٥٠٠)
//
//   المترجمُ يختار السورةَ والآيةَ — أو يبحث بكلمةٍ منها — فتُدرَج الآيةُ
//   كما هي في المصدر، مغلقةً لا تُحرَّر، ويُكتَب معها مرجعُها. ثمَّ
//   يُفتَح تحتها سطرٌ لترجمتها. وللمترجم أن يُعرض عن الإدراج ويترجم
//   المعنى مباشرةً، فهذا بابُ إتاحةٍ لا إلزام.
//
//   والحديثُ الشريفُ ليس له منتقٍ: يُكتَب في المتن كسائر الكلام.
import { h, fill, toast, dialog } from './ui.js';
import { db } from './sb.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let readyCache = null;
let suraCache = null;

// هل حُمِّل المصحفُ في الخادم؟ يُسأل مرّةً في الجلسة
export async function quranReady() {
  if (readyCache !== null) return readyCache;
  try {
    const v = await db.rpc('quran_ready');
    const o = Array.isArray(v) ? v[0] : v;
    readyCache = !!(o && o.ready);
  } catch { readyCache = false; }
  return readyCache;
}

async function suras() {
  if (suraCache) return suraCache;
  try {
    const r = await db.select('quran_suras', { select: 'sura,name_ar,ayat', order: 'sura.asc' });
    suraCache = Array.isArray(r) ? r : [];
  } catch { suraCache = []; }
  return suraCache;
}

// ـــ صورةُ الآية في المتن: فقرةٌ مغلقةٌ تحمل مرجعَها، وتحتها سطرُ ترجمتها
export function ayaHtml(rows, tr = '') {
  if (!rows.length) return '';
  // ـــ المرجعُ يُبنى مُدًى متَّصلةً: «٢:١-٣» للمتَّصل، وتُفصَل المدى
  //   بفاصلةٍ إن جُمعت آياتٌ من مواضعَ شتّى — فيبقى لكلِّ حرفٍ مرجعُه
  //   وتُقابَل في الخادم بأصلها (ملاحظة ٥٠٠)
  const runs = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.sura === r.sura && r.aya === last.to + 1) { last.to = r.aya; continue; }
    runs.push({ sura: r.sura, from: r.aya, to: r.aya, name: r.sura_name || '' });
  }
  const ref = runs.map(x => `${x.sura}:${x.from}${x.to > x.from ? `-${x.to}` : ''}`).join(',');
  const label = [...new Set(runs.map(x => x.name).filter(Boolean))].join('، ');
  // ـــ رقمُ الآية في دارته كما في المصحف
  //
  //   الخطُّ العثمانيُّ يرسم أرقامَ الآي في دارتها المزخرفة من تلقائه،
  //   فلا يُزاد عليها محرفُ «نهاية الآية» — وإلّا رُسمت دارتان: دارةٌ
  //   فارغةٌ للمحرف وأخرى للعدد، وهو ما ظهر في التجربة.
  const AN = n => String(n ?? '').replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  const text = rows.map(r => `${r.text_uthmani} ${AN(r.aya)}`).join(' ');
  // ـــ الآيةُ تُدرَج داخلَ السطر لا فقرةً مستقلّة (ملاحظتا ٨ و٩)
  //
  //   كانت تُدرَج فقرةً مغلقةً وتُتبَع بفقرةٍ فارغة، فكان المؤشِّرُ يقع
  //   بعدها في سطرٍ جديدٍ ولا يُتِمُّ المترجمُ كلامَه في سطرها، وكانت
  //   موسَّطةً قسرًا لا تقبل التيمين. فصارت قطعةً داخل السطر: يبقى
  //   المؤشِّرُ بعدها حيث انتهت، وتتبع محاذاةَ فقرتها كسائر النصّ.
  //   والإغلاقُ على نصِّ الآية وحدَه، فلا يُحرَّف ولا يُحرَّر.
  return `<span class="aya" dir="rtl" data-aya="${esc(ref)}" contenteditable="false">`
    + `﴿${esc(text)}﴾`
    + `<span class="aya-ref"> [${esc(label)}]</span></span>`
    // ترجمةُ الآية المعتمَدةُ بعدها، وهي محرَّرةٌ يتصرَّف فيها المترجم
    + (tr ? ` <span class="aya-tr">${esc(tr)}</span>` : '')
    + '&nbsp;';
}

// ـــ نافذةُ الانتقاء
export async function ayaPick(lang = '') {
  if (!(await quranReady())) {
    toast('لم يُحمَّل المصحفُ في الخادم بعد — راجعْ مديرَ المشروع.', 'warn');
    return '';
  }
  const list = await suras();
  const sura = h('select', { 'aria-label': 'السورة' },
    h('option', { value: '' }, 'السورة'),
    list.map(s => h('option', { value: String(s.sura) },
      `${AR(s.sura)} — ${s.name_ar} (${AR(s.ayat)})`)));
  const from = h('input', { type: 'number', min: '1', max: '286', placeholder: 'من آية',
    'aria-label': 'من آية' });
  const to = h('input', { type: 'number', min: '1', max: '286', placeholder: 'إلى آية',
    'aria-label': 'إلى آية' });
  const q = h('input', { type: 'search', placeholder: 'أو ابحثْ بكلمةٍ من الآية',
    'aria-label': 'البحث في نص الآيات' });
  const box = h('div.pick-list.tall');
  const chosen = new Set();
  let rows = [];

  // بيانُ الترجمة المعتمَدة: اسمُها ومترجمُها، أو أنَّها لم تُحمَّل بعد
  const trNote = h('p.small.muted');
  // ـــ المختارُ يُجمَع في قطعةٍ واحدةٍ أو يُفرَّق قطعةً قطعة
  //   (ملاحظةُ «أحتاج ثلاثَ آياتٍ لا أريدها منفصلة»)
  const joinBox = h('input', { type: 'checkbox', checked: true });
  (async () => {
    if (!lang) { trNote.remove(); return; }
    try {
      const r = await db.rpc('quran_tr_ready');
      const ed = (Array.isArray(r) ? r : []).find(x => x.lang === lang);
      trNote.textContent = ed
        ? `الترجمةُ المعتمَدةُ لهذه اللغة: ${ed.title}`
          + (ed.translator ? ` — ${ed.translator}` : '')
          + `، وتُدرَج بنصِّها.`
        : 'لم تُحمَّلْ ترجمةٌ معتمَدةٌ لهذه اللغة بعد، فتُدرَج الآيةُ وحدَها '
          + 'وتكتب ترجمتَها بنفسك.';
    } catch { trNote.remove(); }
  })();

  const paint = () => {
    fill(box, rows.length ? rows.map(r => {
      const key = `${r.sura}:${r.aya}`;
      const on = h('input', { type: 'checkbox', checked: chosen.has(key),
        'aria-label': `${r.sura_name} ${r.aya}` });
      on.onchange = () => { on.checked ? chosen.add(key) : chosen.delete(key); };
      return h('label.check.pick-row', on,
        h('span', h('b.aya-pick', r.text_uthmani),
          h('span.small.muted', ` [${r.sura_name || ''}: ${AR(r.aya)}]`),
          // الترجمةُ المعتمَدةُ تُعرَض كما ستُدرَج، فلا يُدرِج المترجمُ ما لم يره
          r.tr ? h('div.small.muted', r.tr) : null));
    }) : [h('p.small.muted', 'اختَرْ سورةً أو ابحثْ بكلمة.')]);
  };

  const load = async () => {
    fill(box, h('p.small.muted', 'يُحمَّل…'));
    try {
      const r = await db.rpc('quran_pick', {
        p_sura: sura.value ? Number(sura.value) : null,
        p_from: from.value ? Number(from.value) : null,
        p_to: to.value ? Number(to.value) : null,
        p_q: q.value.trim() || null, p_limit: 60, p_lang: lang || null
      });
      rows = Array.isArray(r) ? r : [];
      // وتبديلُ الانتقاء يُفرِّغ ما اختير، فلا تُدرَج آيةٌ من بحثٍ سابق
      chosen.clear();
      paint();
    } catch (e) { fill(box, h('p.bad', e.message)); }
  };
  sura.onchange = load; from.oninput = load; to.oninput = load;
  let t = 0;
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  paint();

  const res = await dialog({
    title: 'إدراجُ آيةٍ بالرسم العثماني',
    body: h('div.stack',
      h('p.small.muted', 'تُدرَج الآيةُ كما هي في المصحف، ولا تُحرَّر في المحرر، '
        + 'ويُحفَظ مرجعُها فتُقابَل بأصلها عند الحفظ. '
        + 'وتُدرَج معها ترجمتُها المعتمَدةُ بنصِّها إن كانت محمَّلةً للغة المسار، '
        + 'ولك أن تتصرَّف فيها بعد إدراجها. والحديثُ يُكتَب في المتن كسائر الكلام.'),
      trNote,
      h('div.row.wrap',
        h('label.field.tight', 'السورة', sura),
        h('label.field.tight', 'من', from),
        h('label.field.tight', 'إلى', to)),
      h('label.field', 'بحثٌ في النص', q),
      box,
      h('label.check', joinBox,
        h('span', 'اجمعِ المختارَ في قطعةٍ واحدة',
          h('span.small.muted', ' — وإلّا أُدرِجت كلُّ آيةٍ قطعةً مستقلّةً بمرجعها')))),
    buttons: [
      { label: 'أدرِجِ المختار', kind: 'primary',
        validate: () => (chosen.size ? true : 'اختَرْ آيةً واحدةً على الأقل'),
        value: () => rows.filter(r => chosen.has(`${r.sura}:${r.aya}`)) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res || !res.length) return '';
  // والجمعُ خيارُ المترجم: قطعةٌ واحدةٌ تحمل مرجعَ ما فيها كلِّه،
  //   أو قطعةٌ لكلِّ آيةٍ بمرجعها. وترجمتُها المعتمَدةُ تتبعها على ترتيبها
  if (joinBox.checked) {
    const tr = res.map(r => r.tr).filter(Boolean).join(' ');
    return ayaHtml(res, res.every(r => r.tr) ? tr : '');
  }
  return res.map(r => ayaHtml([r], r.tr || '')).join('');
}

// ـــ مراجعةُ المحفوظ: الموسومُ يُقابَل بأصله، والمكتوبُ بالأيدي يُكشَف
//
//   وتُستدعى عند الحفظ، فإن ظهر خللٌ عُرض على المترجم ولم يُمنَع حفظُه:
//   الآيةُ المخالفةُ تُصحَّح بإعادة إدراجها، والمكتوبةُ بالأيدي يُعرَض
//   عليه إدراجُها بالرسم العثماني — والاختيارُ له.
export async function reviewAyat(html, plain) {
  const spans = [];
  try {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    for (const el of doc.querySelectorAll('[data-aya]')) {
      spans.push({ ref: el.getAttribute('data-aya'),
        // ويُطرَح مرجعُ الآية وأقواسُها من المقابلة
        text: (el.textContent || '').replace(/\[[^\]]*\]/g, '').replace(/[﴿﴾]/g, '') });
    }
  } catch { /* نصٌّ لا يُقرأ: تُترَك المراجعة */ }
  if (!spans.length && !plain) return null;
  try {
    const v = await db.rpc('check_ayat', { p_spans: spans, p_body: plain || null });
    const o = Array.isArray(v) ? v[0] : v;
    if (!o || !o.ready) return null;
    const bad = Array.isArray(o.bad) ? o.bad : [];
    const typed = Array.isArray(o.typed) ? o.typed : [];
    return (bad.length || typed.length) ? { bad, typed } : null;
  } catch { return null; }
}

export function ayatReport(r) {
  return h('div.stack',
    r.bad.length ? h('div.stack',
      h('h3', `آياتٌ خولفت عن أصلها (${AR(r.bad.length)})`),
      h('p.small.muted', 'أعِدْ إدراجَها من زرِّ «آية» ليُكتَب نصُّها كما هو.'),
      h('ul', r.bad.map(b => h('li', `${b.ref} — ${b.why}`)))) : null,
    r.typed.length ? h('div.stack',
      h('h3', `نصٌّ قرآنيٌّ كُتب في المتن (${AR(r.typed.length)})`),
      h('p.small.muted', 'الأولى أن يُدرَج بالرسم العثمانيِّ من زرِّ «آية»، '
        + 'ثمَّ تُكتَب ترجمتُه تحته. والأمرُ إليك.'),
      h('ul', r.typed.map(t2 => h('li', h('b.aya-pick', t2.text),
        h('span.small.muted', ` [${t2.sura || ''}: ${AR(t2.aya)}]`))))) : null);
}
