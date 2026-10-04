// الدليل المصطلحي الشرعي الموحَّد — التزامٌ في العقد (ملاحظة ١٥٠)
//   مصطلحٌ عربي، وشرحٌ يوضّح معناه الشرعي، ومقابله المعتمد في كل لغة.
//   الرجوع إليه إلزامي عند لبس المصطلح.
import { h, dialog, toast, busy, fmtDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { state, langName, isAdmin, isManager } from '../store.js';
import { icon } from '../icons.js';
import { buildXlsx, downloadBlob, readSheet } from '../xlsx.js';

// أقسامٌ أوسعُ ممّا كان: المصطلحُ الشرعي، وتوجيهاتُ الإرشاد، والمناسك،
// والأعلامُ التي تُنقل ولا تُترجم، والتعبيرُ القرآني (ملاحظة ٢٣٤)
export const CATEGORIES = ['عقدي', 'فقهي', 'دعوي', 'توجيهات', 'مناسك',
  'أعلام', 'قرآني', 'عام'];

export async function loadTerms() {
  const rows = await db.select('glossary_rows', { select: '*', order: 'term_ar' }).catch(() => []);
  return rows.map(r => ({ ...r, translations: Array.isArray(r.translations) ? r.translations : [] }));
}

// مطابقة البحث: المصطلح أو شرحه أو أيٌّ من مقابلاته
export const matchTerm = (r, q) => {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return String(r.term_ar).toLowerCase().includes(s)
    || String(r.explanation || '').toLowerCase().includes(s)
    || r.translations.some(t => String(t.term_tr).toLowerCase().includes(s));
};

function termDialog(row = null) {
  const f = {
    term: h('input', { value: row?.term_ar || '', 'aria-label': 'المصطلح العربي' }),
    cat: h('select', { 'aria-label': 'التصنيف' },
      CATEGORIES.map(c => h('option', { value: c, selected: (row?.category || 'عام') === c }, c))),
    exp: h('textarea', { rows: 3, 'aria-label': 'شرح المصطلح' }, row?.explanation || '')
  };
  const trOf = code => row?.translations.find(t => t.language_code === code) || {};
  const inputs = state.languages.map(l => {
    const t = trOf(l.code);
    return {
      code: l.code,
      term: h('input', { value: t.term_tr || '', dir: 'auto', 'aria-label': `المقابل بـ${langName(l.code)}` }),
      note: h('input', { value: t.note || '', 'aria-label': `ملاحظة ${langName(l.code)}` })
    };
  });

  const bad = [];
  const body = h('div.stack',
    h('div.grid-2',
      h('label.field', req('المصطلح العربي'), f.term),
      h('label.field', 'التصنيف', f.cat)),
    h('label.field', req('شرحٌ مختصر يوضّح المعنى الشرعي الصحيح'), f.exp),
    h('div.card.stack',
      h('b', 'المقابل المعتمد في كل لغة'),
      h('p.small.muted', 'تُترك اللغة فارغةً حتى يُعتمد لها مقابل.'),
      inputs.map(i => h('div.grid-2',
        h('label.field', langName(i.code), i.term),
        h('label.field', 'ملاحظة (اختياري)', i.note)))));

  const validate = () => {
    bad.forEach(el => markBad(el, false)); bad.length = 0;
    const need = (el, cond, msg) => { if (cond) { bad.push(el); markBad(el, true); return msg; } return null; };
    const errs = [
      need(f.term, !f.term.value.trim(), 'اكتب المصطلح العربي'),
      need(f.exp, !f.exp.value.trim(), 'اكتب شرحًا مختصرًا يوضّح المعنى الشرعي')
    ].filter(Boolean);
    return errs.length ? errs[0] : true;
  };

  return dialog({
    title: row ? 'تعديل مصطلح' : 'إضافة مصطلح',
    body,
    buttons: [
      { label: 'إلغاء', value: null },
      { label: 'حفظ', kind: 'primary', validate, value: () => ({
        id: row?.id || null, term_ar: f.term.value.trim(), category: f.cat.value,
        explanation: f.exp.value.trim(),
        translations: inputs.filter(i => i.term.value.trim())
          .map(i => ({ language_code: i.code, term_tr: i.term.value.trim(), note: i.note.value.trim() }))
      }) }
    ]
  });
}

// ---------------------------------------------------------------------
// معاني المصطلح: لكلِّ معنًى عنوانُه وترجمتُه في كلِّ لغةٍ وشواهدُه.
// فالمصطلحُ يتغيّر معناه بتغيّر الجملة، ولا يُترجَم مجرَّدًا عن سياقه
// (ملاحظة ٢٣٤). وتقسيمُ المعاني للإنسان لا للآلة: المنصةُ تأتي بالشواهد
// وترتّب، ولا تقترح معنًى من نفسها.
// ---------------------------------------------------------------------
async function sensesDialog(term) {
  let senses = [], trs = [], exs = [];
  const reload = async () => {
    senses = await db.select('glossary_senses',
      { select: '*', term_id: `eq.${term.id}`, order: 'sort.asc,label.asc' }).catch(() => []);
    const ids = senses.map(s => s.id);
    if (ids.length) {
      const inList = `in.(${ids.join(',')})`;
      [trs, exs] = await Promise.all([
        db.select('glossary_sense_translations', { select: '*', sense_id: inList }).catch(() => []),
        db.select('glossary_examples', { select: '*', sense_id: inList }).catch(() => [])
      ]);
    } else { trs = []; exs = []; }
  };
  await reload();

  const box = h('div.stack');
  const draw = () => {
    box.replaceChildren(...(senses.length ? senses.map(s => {
      const mine = trs.filter(t => t.sense_id === s.id);
      const quotes = exs.filter(e => e.sense_id === s.id);
      return h('article.card.stack', { style: { padding: '12px' } },
        h('div.row.between', h('b', s.label),
          h('div.row',
            h('button.btn.xs', { type: 'button',
              onclick: async () => { if (await senseDialog(term, s, mine, quotes)) { await reload(); draw(); } } },
              'حرّر'),
            isAdmin() ? h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
              try { await db.rpc('delete_glossary_sense', { p_id: s.id }); await reload(); draw(); }
              catch (e) { toast(e.message, 'bad'); }
            } }, 'احذف') : null)),
        s.explanation ? h('p.small', s.explanation) : null,
        mine.length ? h('ul.small', mine.map(t => h('li', `${langName(t.language_code)}: `,
          h('b', { dir: 'auto' }, t.term_tr), t.note ? h('span.muted', ` — ${t.note}`) : null)))
          : h('p.small.warn', 'بلا ترجمةٍ لهذا المعنى بعد.'),
        quotes.length ? h('blockquote.small.muted', quotes[0].quote) : null);
    }) : [h('p.muted', 'لا معاني بعد — والمصطلحُ بلا معنًى لا يُترجم على بيان.')]));
  };
  draw();

  return dialog({
    title: `معاني «${term.term_ar}»`,
    body: h('div.stack',
      h('p.small.muted', 'للمصطلح الواحد معانٍ تختلف باختلاف الجملة، ولكلِّ معنًى ترجمتُه '
        + 'في كلِّ لغةٍ وشاهدُه من عملٍ بعينه. فلا يُترجَم مصطلحٌ مجرَّدًا عن سياقه.'),
      box,
      h('div.row', h('button.btn.sm.primary', { type: 'button', onclick: async () => {
        if (await senseDialog(term, null, [], [])) { await reload(); draw(); }
      } }, '＋ معنًى'))),
    buttons: [{ label: 'إغلاق', value: null }]
  });
}

async function senseDialog(term, sense, trs, quotes) {
  const label = h('input', { value: sense?.label || '', 'aria-label': 'عنوان المعنى',
    placeholder: `${term.term_ar}: …` });
  const exp = h('textarea', { rows: 2, 'aria-label': 'شرح المعنى' }, sense?.explanation || '');
  const inputs = (state.languages || []).map(l => {
    const t = trs.find(x => x.language_code === l.code) || {};
    return { code: l.code,
      term: h('input', { value: t.term_tr || '', dir: 'auto',
        'aria-label': `ترجمة المعنى بـ${langName(l.code)}` }),
      note: h('input', { value: t.note || '', 'aria-label': `ملاحظة ${langName(l.code)}` }) };
  });

  // شواهدُ من الأرشيف: المنصةُ تأتي بها، والاختيارُ للإنسان
  const quoteBox = h('div.stack');
  const chosen = new Set();
  const drawQuotes = (list) => {
    quoteBox.replaceChildren(...(list.length ? list.map(q => {
      const b = h('button.btn.xs' + (chosen.has(q.quote) ? '.primary' : '.ghost'),
        { type: 'button' }, q.quote.slice(0, 90) + '…');
      b.onclick = () => { chosen.has(q.quote) ? chosen.delete(q.quote) : chosen.add(q.quote);
        drawQuotes(list); };
      return b;
    }) : [h('p.small.muted', 'لم يُعثر على شاهدٍ لهذا اللفظ في الأرشيف.')]));
  };
  const findBtn = h('button.btn.xs', { type: 'button' }, 'ابحث عن شواهد في الأرشيف');
  findBtn.onclick = () => busy(findBtn, async () => {
    quoteBox.replaceChildren(h('p.small.muted', 'جارٍ البحث…'));
    try { drawQuotes(await db.rpc('sense_quotes', { p_term: term.term_ar, p_limit: 5 })); }
    catch (e) { quoteBox.replaceChildren(h('p.small.warn', e.message)); }
  });

  const res = await dialog({
    title: sense ? `تحرير «${sense.label}»` : `معنًى جديدٌ لـ«${term.term_ar}»`,
    body: h('div.stack',
      h('label.field', 'عنوان المعنى', label,
        h('small', 'مثل: «الهدى: الدلالةُ والإرشاد» — ليُعرف المعنى من عنوانه')),
      h('label.field', 'شرح المعنى', exp),
      h('fieldset.stack', h('legend', 'ترجمةُ هذا المعنى'),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['اللغة', 'الترجمة', 'ملاحظة'].map(t => h('th', t)))),
          h('tbody', inputs.map(i => h('tr',
            h('td', { 'data-label': 'اللغة' }, langName(i.code)),
            h('td', { 'data-label': 'الترجمة' }, i.term),
            h('td', { 'data-label': 'ملاحظة' }, i.note))))))),
      h('fieldset.stack', h('legend', 'الشواهد'),
        quotes.length ? h('ul.small', quotes.map(q => h('li', q.quote))) : null,
        h('div.row', findBtn), quoteBox)),
    buttons: [
      { label: 'حفظ', kind: 'primary',
        validate: () => (label.value.trim().length >= 2 ? true : 'اكتب عنوان المعنى'),
        value: () => ({ id: sense?.id || null, term_id: term.id,
          label: label.value.trim(), explanation: exp.value.trim() || null,
          translations: inputs.map(i => ({ language_code: i.code,
            term_tr: i.term.value.trim(), note: i.note.value.trim() || null })),
          examples: [...chosen].map(q => ({ quote: q })) }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try { await db.rpc('save_glossary_sense', { p: res }); toast('حُفظ المعنى.', 'ok'); return true; }
  catch (e) { toast(e.message, 'bad'); return false; }
}

// ---------------------------------------------------------------------
// المرصد: يَرصد المتكرِّر في أصول الأرشيف العربية، ويعرضه مرشَّحًا
// ---------------------------------------------------------------------
async function observatoryCard(onAdded) {
  const box = h('div.stack');
  const info = h('p.small.muted');

  const load = async () => {
    let rows = [];
    try {
      rows = await db.select('term_candidates',
        { select: '*', state: 'eq.new', order: 'works.desc,hits.desc', limit: 40 });
    } catch (e) { box.replaceChildren(h('p.small.warn', e.message)); return; }
    info.textContent = rows.length
      ? `${rows.length} مرشَّحًا ينتظر النظر — ويُرتَّبون بكم تكرّر اللفظُ وفي كم عمل.`
      : 'لا مرشَّحين. اضغط «ارصد الآن» ليمسح المرصدُ أصولَ الأرشيف.';
    box.replaceChildren(rows.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['اللفظ', 'تكرّر', 'في أعمال', ''].map(t => h('th', t)))),
      h('tbody', rows.map(c => h('tr',
        h('td', { 'data-label': 'اللفظ' }, h('b', c.raw)),
        h('td', { 'data-label': 'تكرّر' }, String(c.hits)),
        h('td', { 'data-label': 'في أعمال' }, String(c.works)),
        h('td', h('div.row',
          h('button.btn.xs.primary', { type: 'button', onclick: async () => {
            try {
              await db.rpc('propose_glossary_term', { p: { term_ar: c.raw, category: 'عام' } });
              toast('أُضيف إلى الدليل.', 'ok');
              await load(); if (onAdded) await onAdded();
            } catch (e) { toast(e.message, 'bad'); }
          } }, 'أضِفه'),
          h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
            try { await db.rpc('ignore_candidate', { p_norm: c.norm }); await load(); }
            catch (e) { toast(e.message, 'bad'); }
          } }, 'تجاهله')))))))) : null);
  };

  const scan = h('button.btn.sm', { type: 'button' }, '⟳ ارصد الآن');
  scan.onclick = () => busy(scan, async () => {
    try {
      const out = await db.rpc('scan_terms', { p_min_works: 2, p_max: 400 });
      const d = (Array.isArray(out) ? out[0] : out) || {};
      toast(`رُصد ${d.scanned || 0}، وينتظر ${d.pending || 0}.`, 'ok');
      await load();
    } catch (e) { toast(e.message, 'bad'); }
  });

  await load();
  return h('section.card.stack',
    h('div.row.between', h('h3', 'مرصد المصطلحات'), scan),
    h('p.small.muted', 'يمسح المرصدُ الأصولَ العربية في أرشيف الترجمة فيُخرج المتكرِّرَ من '
      + 'الألفاظ والتراكيب. وهو يَرصد ولا يُفتي: الإضافةُ والتجاهلُ بيدك، '
      + 'وتقسيمُ المعاني بعد ذلك إليك.'),
    info, box);
}

// ---------------------------------------------------------------------
// سجلُّ المشاركة: عدٌّ ووقائعُ لا تقييم (ملاحظة ٢٣٥)
// ---------------------------------------------------------------------
export async function contribCard({ own = false } = {}) {
  let rows = [];
  const me = state.profile?.id || null;
  try { rows = await db.rpc('glossary_contrib', { p_member: own ? me : null }); } catch { rows = []; }
  const mine = own ? rows
    : rows.filter(r => r.proposed || r.senses || r.translations);
  const rate = r => (r.proposed ? Math.round((r.approved / r.proposed) * 100) : null);

  return h('section.card.stack',
    h('h3', own || !isAdmin() ? 'مشاركتي في الدليل المصطلحي' : 'المشاركة في الدليل المصطلحي'),
    h('p.small.muted', 'سجلُّ مشاركةٍ معدودٌ لا تقييم: فالتقييمُ يأتي من مشرفي الهيئة '
      + 'ونحن نسجّله، ولا تولّده المنصةُ من أرقامها. ولا يدخل هذا في التقرير الشهري للعقد.'),
    mine.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'قدّم', 'اعتُمد', 'رُدَّ', 'معانٍ', 'ترجمات', 'نسبة الاعتماد', 'أثر المصطلح']
        .map(t => h('th', t)))),
      h('tbody', mine.map(r => h('tr',
        h('td', { 'data-label': 'العضو' }, r.full_name),
        h('td', { 'data-label': 'قدّم' }, String(r.proposed)),
        h('td', { 'data-label': 'اعتُمد' }, h('b', String(r.approved))),
        h('td', { 'data-label': 'رُدَّ' }, String(r.rejected)),
        h('td', { 'data-label': 'معانٍ' }, String(r.senses)),
        h('td', { 'data-label': 'ترجمات' }, String(r.translations)),
        h('td', { 'data-label': 'نسبة الاعتماد' },
          rate(r) === null ? '—' : h('span.badge' + (rate(r) >= 70 ? '.ok' : ''), `${rate(r)}٪`)),
        h('td', { 'data-label': 'أثر المصطلح' },
          r.impact ? h('span', `ورد ${r.impact} مرة`) : h('span.muted', '—')))))))
      : h('p.muted', 'لا مشاركاتٍ بعد.'));
}

export async function render() {
  const admin = isAdmin();
  let terms = await loadTerms();

  const f = {
    q: h('input', { type: 'search', placeholder: 'ابحث في المصطلحات ومقابلاتها…', 'aria-label': 'بحث' }),
    cat: h('select', { 'aria-label': 'التصنيف' }, h('option', { value: '' }, 'كل التصنيفات'),
      CATEGORIES.map(c => h('option', { value: c }, c))),
    lang: h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'),
      state.languages.map(l => h('option', { value: l.code }, langName(l.code)))),
    status: h('select', { 'aria-label': 'الحال' }, h('option', { value: '' }, 'الكل'),
      h('option', { value: 'معتمد' }, 'المعتمد'), h('option', { value: 'مقترح' }, 'المقترح'))
  };

  const list = h('div.stack');
  const count = h('span.badge');

  const reload = async () => { terms = await loadTerms(); draw(); };

  const edit = async row => {
    const p = await termDialog(row);
    if (!p) return;
    try { await db.rpc('save_glossary_term', { p }); toast('حُفظ المصطلح.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const approve = async (row, on) => {
    try {
      await db.rpc('approve_glossary_term', { p_id: row.id, p_on: on });
      toast(on ? 'اعتُمد المصطلح.' : 'رُفع الاعتماد.', 'ok');
      await reload();
    } catch (err) { toast(err.message, 'bad'); }
  };

  const remove = async row => {
    const ok = await dialog({ title: 'حذف المصطلح', body: h('p', `يُحذف «${row.term_ar}» ومقابلاته كلها؟`),
      buttons: [{ label: 'إلغاء', value: false }, { label: 'حذف', kind: 'bad', value: true }] });
    if (!ok) return;
    try { await db.rpc('delete_glossary_term', { p_id: row.id }); toast('حُذف المصطلح.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const filtered = () => terms.filter(r => matchTerm(r, f.q.value)
    && (!f.cat.value || r.category === f.cat.value)
    && (!f.status.value || r.status === f.status.value)
    && (!f.lang.value || r.translations.some(t => t.language_code === f.lang.value)));

  function card(r) {
    const shown = f.lang.value ? r.translations.filter(t => t.language_code === f.lang.value) : r.translations;
    return h('article.card.stack.term-card',
      h('div.row.between',
        h('div', h('b.term-ar', r.term_ar), h('span.badge', { style: { marginInlineStart: '8px' } }, r.category)),
        h('span.badge', { class: r.status === 'معتمد' ? 'ok' : 'warn' }, r.status)),
      h('p.small', r.explanation),
      shown.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['اللغة', 'المقابل المعتمد', 'ملاحظة'].map(t => h('th', t)))),
            h('tbody', shown.map(t => h('tr',
              h('td', { 'data-label': 'اللغة' }, langName(t.language_code)),
              h('td', { 'data-label': 'المقابل المعتمد' }, h('b', { dir: 'auto' }, t.term_tr)),
              h('td', { 'data-label': 'ملاحظة' }, h('span.small.muted', t.note || '—')))))))
        : h('p.small.muted', 'لم يُعتمد له مقابلٌ بعد.'),
      r.approved_at ? h('p.small.muted', `اعتُمد في ${fmtDate(r.approved_at)}`) : null,
      h('div.row',
        h('button.btn.xs', { type: 'button', onclick: () => edit(r) }, 'تعديل'),
        admin ? h('button.btn.xs', { type: 'button', onclick: () => approve(r, r.status !== 'معتمد') },
          r.status === 'معتمد' ? 'رفع الاعتماد' : 'اعتماد') : null,
        h('button.btn.xs', { type: 'button', onclick: () => sensesDialog(r) }, 'المعاني'),
        admin ? h('button.btn.xs.bad', { type: 'button', onclick: () => remove(r) }, 'حذف') : null));
  }

  function draw() {
    const l = filtered();
    count.textContent = `${l.length} مصطلحًا`;
    list.replaceChildren(...(l.length ? l.map(card)
      : [h('p.muted', terms.length ? 'لا مصطلح يطابق البحث.' : 'الدليل فارغ — أضف أول مصطلح.')]));
  }

  f.q.addEventListener('input', draw);
  for (const k of ['cat', 'lang', 'status']) f[k].addEventListener('change', draw);

  const addBtn = h('button.btn.sm.primary', { type: 'button' }, '+ إضافة مصطلح');
  addBtn.onclick = () => edit(null);

  // ---------------- الاستيراد من ملف: يبني الفريق الدليل معًا (ملاحظة ١٥٨) ----------------
  const codes = () => state.languages.map(l => l.code);
  const headerRow = () => ['المصطلح', 'التصنيف', 'الشرح', ...state.languages.map(l => langName(l.code))];

  const tmplBtn = h('button.btn.sm', { type: 'button' }, '⤓ نموذج الاستيراد');
  tmplBtn.onclick = () => {
    const rows = [headerRow(),
      ['التقوى', 'عقدي', 'امتثال الأمر واجتناب النهي.',
        ...state.languages.map(l => (l.code === 'en' ? 'Taqwa (God-consciousness)' : ''))],
      ['الصلاة', 'فقهي', 'الفريضة ذات الأقوال والأفعال المفتتحة بالتكبير المختتمة بالتسليم.',
        ...state.languages.map(() => '')]];
    downloadBlob(buildXlsx(rows, { sheetName: 'المصطلحات', allText: true }), 'نموذج الدليل المصطلحي.xlsx');
    toast('نُزِّل النموذج — املأه ثم استورده.', 'ok');
  };

  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true, 'aria-label': 'ملف المصطلحات' });
  const impBtn = h('button.btn.sm', { type: 'button' }, '⤒ استيراد من Excel');
  impBtn.onclick = () => fileIn.click();
  fileIn.onchange = () => busy(impBtn, async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    try {
      const sheet = await readSheet(file);
      if (sheet.length < 2) return toast('الملف فارغ أو بلا صفوف بعد العناوين.', 'bad');
      const head = sheet[0].map(v => String(v).trim());
      const at = name => head.findIndex(x => x === name);
      const iTerm = at('المصطلح'), iCat = at('التصنيف'), iExp = at('الشرح');
      if (iTerm < 0 || iExp < 0) {
        return toast('لم يُعثر على عمودي «المصطلح» و«الشرح» — نزّل النموذج والتزم عناوينه.', 'bad');
      }
      // أعمدة اللغات: تُطابَق باسم اللغة في العنوان
      const langCols = [];
      state.languages.forEach(l => { const i = at(langName(l.code)); if (i >= 0) langCols.push([i, l.code]); });

      const rowsIn = sheet.slice(1).map(r => ({
        term_ar: String(r[iTerm] ?? '').trim(),
        category: iCat >= 0 ? String(r[iCat] ?? '').trim() : '',
        explanation: String(r[iExp] ?? '').trim(),
        translations: langCols.map(([i, code]) => ({ language_code: code, term_tr: String(r[i] ?? '').trim() }))
          .filter(x => x.term_tr)
      })).filter(x => x.term_ar);
      if (!rowsIn.length) return toast('لا مصطلحات في الملف.', 'bad');

      const ok = await dialog({
        title: 'استيراد المصطلحات',
        body: h('div.stack',
          h('p', `في الملف ${rowsIn.length} مصطلحًا، و${langCols.length} عمود لغة.`),
          h('p.small.muted', 'الموجود يُحدَّث شرحُه ومقابلاته، والجديد يُضاف بحال «مقترح» حتى تعتمده الإدارة.'),
          h('ul.small', rowsIn.slice(0, 5).map(x => h('li', h('b', x.term_ar), ` — ${x.explanation.slice(0, 60)}`))),
          rowsIn.length > 5 ? h('p.small.muted', `… و${rowsIn.length - 5} غيرها`) : null),
        buttons: [{ label: 'إلغاء', value: false }, { label: 'استيراد', kind: 'primary', value: true }]
      });
      if (!ok) return;

      const res = await db.rpc('import_glossary', { p_rows: rowsIn });
      const r = Array.isArray(res) ? res[0] : res;
      toast(`أُضيف ${r?.added ?? 0}، وحُدِّث ${r?.updated ?? 0}${r?.skipped ? `، وتُخطّي ${r.skipped} ناقصًا` : ''}.`, 'ok');
      await reload();
    } catch (err) { toast(err.message, 'bad'); }
  });

  const fmtSel = h('select', { 'aria-label': 'صيغة التصدير' },
    h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
  const expBtn = h('button.btn.sm', { type: 'button' }, 'تصدير الدليل');
  expBtn.onclick = () => busy(expBtn, async () => {
    const l = filtered();
    const codes = state.languages.map(x => x.code);
    const out = [['المصطلح', 'التصنيف', 'الشرح', 'الحال', ...codes.map(c => langName(c))]];
    for (const r of l) {
      out.push([r.term_ar, r.category, r.explanation, r.status,
        ...codes.map(c => r.translations.find(t => t.language_code === c)?.term_tr || '')]);
    }
    const title = 'الدليل المصطلحي الشرعي الموحَّد';
    try {
      if (fmtSel.value === 'xlsx') downloadBlob(buildXlsx(out, { sheetName: 'المصطلحات', allText: true }), `${title}.xlsx`);
      else {
        const { exportPdf } = await import('../teamexport.js');
        if (!exportPdf(out, title, { note: 'الرجوع إليه إلزامي عند لبس المصطلح — كما في العقد.' })) {
          return toast('اسمح بالنوافذ المنبثقة.', 'bad');
        }
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  // ---------------- بطاقاتُ اللغات (ملاحظة ٢٣٤) ----------------
  // عند الدخول: بطاقةٌ لكلِّ لغةٍ أساسية، وفي كلٍّ ما تمَّ وما نقص.
  // وتُضاف بطاقاتُ ما سواها متى احتيج إليها.
  const cards = h('div.gl-cards');
  const drawCards = (rows) => {
    const core = rows.filter(r => r.is_core);
    const rest = rows.filter(r => !r.is_core && (r.done || r.missing === 0));
    const mk = (r) => {
      const b = h('button.gl-card' + (f.lang.value === r.code ? '.on' : ''), { type: 'button' },
        h('b', r.name_ar), h('span.gl-native', { dir: r.dir || 'ltr' }, r.native_name),
        h('span.sub', `${r.done} مصطلحًا`),
        r.missing ? h('span.sub.warn', `ينقص ${r.missing}`) : h('span.sub', 'مكتملة'));
      b.onclick = () => {
        f.lang.value = f.lang.value === r.code ? '' : r.code;
        drawCards(rows); draw();
      };
      return b;
    };
    const more = h('button.gl-card.gl-more', { type: 'button' },
      icon('globe', { size: 22 }), h('b', '＋ لغة أخرى'),
      h('span.sub', 'من اللغات المسجَّلة'));
    more.onclick = async () => {
      const sel = h('select', { 'aria-label': 'اللغة' },
        rows.filter(r => !r.is_core).map(r => h('option', { value: r.code }, r.name_ar)));
      const ok = await dialog({ title: 'بطاقةُ لغةٍ أخرى',
        body: h('div.stack', h('p.small.muted', 'تُفتح بطاقةُ اللغة فتُملأ مصطلحاتُها.'),
          h('label.field', 'اللغة', sel)),
        buttons: [{ label: 'افتح', kind: 'primary', value: () => sel.value },
          { label: 'إلغاء', value: null }] });
      if (!ok) return;
      f.lang.value = ok; drawCards(rows); draw();
    };
    cards.replaceChildren(...core.map(mk), ...rest.map(mk), more);
  };
  db.rpc('glossary_cards').then(drawCards).catch(() => {});

  // ---------------- ما ينتظر الاعتماد ----------------
  const queue = h('div.stack');
  const drawQueue = () => {
    if (!admin) { queue.replaceChildren(); return; }
    const pend = terms.filter(r => r.status === 'مقترح');
    queue.replaceChildren(pend.length ? h('section.card.stack',
      h('h3', `مقترحاتٌ تنتظر النظر (${pend.length})`),
      h('p.small.muted', 'يقترح المترجمُ فيُسجَّل «مقترحًا» ولا يُعرض للفريق حتى يُعتمد. '
        + 'ولك الاعتمادُ أو الردُّ بسببه أو التعديلُ ثم الاعتماد.'),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['المصطلح', 'القسم', 'الشرح', ''].map(t => h('th', t)))),
        h('tbody', pend.map(r => h('tr',
          h('td', { 'data-label': 'المصطلح' }, h('b', r.term_ar)),
          h('td', { 'data-label': 'القسم' }, r.category),
          h('td', { 'data-label': 'الشرح' }, h('span.small', (r.explanation || '').slice(0, 90) || '—')),
          h('td', h('div.row',
            h('button.btn.xs.primary', { type: 'button', onclick: async () => {
              try { await db.rpc('review_glossary_term', { p_id: r.id, p_approve: true });
                toast('اعتُمد.', 'ok'); await reload(); drawQueue(); }
              catch (e) { toast(e.message, 'bad'); }
            } }, 'اعتمد'),
            h('button.btn.xs', { type: 'button', onclick: () => edit(r) }, 'عدّل'),
            h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
              const why = h('input', { 'aria-label': 'السبب' });
              const ok = await dialog({ title: `ردُّ «${r.term_ar}»`,
                body: h('div.stack', h('label.field', 'السبب — يراه صاحبُ المقترح', why)),
                buttons: [{ label: 'ردّ', kind: 'bad', value: () => why.value.trim() || 'بلا سبب' },
                  { label: 'إلغاء', value: null }] });
              if (!ok) return;
              try { await db.rpc('review_glossary_term',
                { p_id: r.id, p_approve: false, p_reason: ok });
                toast('رُدَّ المقترح.', 'ok'); await reload(); drawQueue(); }
              catch (e) { toast(e.message, 'bad'); }
            } }, 'ردّ'))))))))) : null);
  };

  draw();
  drawQueue();

  // المرصدُ وسجلُّ المشاركة يُضافان بعد الرسم فلا يؤخّران الشاشة
  const extras = h('div.stack');
  (async () => {
    try {
      if (admin) extras.append(await observatoryCard(async () => { await reload(); drawQueue(); }));
      extras.append(await contribCard());
    } catch { /* لا تمنع الشاشة */ }
  })();

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        fmtSel, expBtn, tmplBtn, impBtn, fileIn, addBtn),
      h('div.grow', h('div.eyebrow', 'المرجع'), h('h1', 'الدليل المصطلحي الشرعي'),
        h('p.muted', 'مصطلحٌ واحد ومقابلٌ واحد في كل لغة، فلا يختلف المترجمون في لفظٍ شرعي. '
          + 'والرجوع إليه إلزامي عند لبس المصطلح.'))),
    h('div.card.stack.gl-open',
      h('b', 'الدليل يُبنى بالفريق كله'),
      h('p.small.muted', 'لكل عضو أن يضيف مصطلحًا أو يستورد ملفًّا، ويُحفظ بحال «مقترح» '
        + 'حتى يعتمده المنسق أو مدير المشروع فيصير هو المعتمد. '
        + 'وللاستيراد نزّل النموذج، واكتب في أعمدته: المصطلح · التصنيف · الشرح · ثم عمودًا لكل لغة باسمها.')),
    cards,
    queue,
    h('div.card.stack',
      h('div.row.between', h('b', 'البحث'), count),
      f.q,
      h('div.grid-2',
        h('label.field', 'التصنيف', f.cat),
        h('label.field', 'اللغة', f.lang),
        h('label.field', 'الحال', f.status))),
    list,
    extras);
}

// لوحة البحث السريع داخل شاشة الترجمة: لا يغادر المترجم عمله (ملاحظة ١٥٠)
export async function glossaryPanel() {
  const terms = await loadTerms();
  const q = h('input', { type: 'search', placeholder: 'ابحث عن مصطلح…', 'aria-label': 'بحث في الدليل المصطلحي' });
  const out = h('div.stack.gl-results');
  const draw = () => {
    const l = terms.filter(r => matchTerm(r, q.value)).slice(0, 20);
    out.replaceChildren(...(l.length ? l.map(r => h('div.gl-hit',
      h('div.row.between', h('b', r.term_ar),
        h('span.badge', { class: r.status === 'معتمد' ? 'ok' : 'warn' }, r.status)),
      h('p.small.muted', r.explanation),
      r.translations.length
        ? h('ul.small', r.translations.map(t => h('li', `${langName(t.language_code)}: `,
            h('b', { dir: 'auto' }, t.term_tr), t.note ? h('span.muted', ` — ${t.note}`) : null)))
        : h('p.small.muted', 'بلا مقابلٍ معتمد بعد.')))
      : [h('p.small.muted', terms.length ? 'لا مصطلح يطابق البحث.' : 'الدليل فارغ.')]));
  };
  q.addEventListener('input', draw);
  draw();
  return dialog({
    title: 'الدليل المصطلحي الشرعي',
    body: h('div.stack', q, out,
      h('p.small.muted', 'الرجوع إلى الدليل إلزامي عند لبس المصطلح، كما في العقد.')),
    buttons: [{ label: 'إغلاق', value: null }]
  });
}
