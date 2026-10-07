// الدليل المصطلحي الشرعي الموحَّد — التزامٌ في العقد (ملاحظة ١٥٠)
//   مصطلحٌ عربي، وشرحٌ يوضّح معناه الشرعي، ومقابله المعتمد في كل لغة.
//   الرجوع إليه إلزامي عند لبس المصطلح.
import { h, dialog, toast, busy, confirm, fmtDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { state, langName, trLangs, langByName, isAdmin, isManager, can } from '../store.js';
import { icon } from '../icons.js';
import { buildXlsx, buildXlsxBook, downloadBlob, readWorkbook } from '../xlsx.js';
import { arBare } from '../teamexport.js';

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
  const inputs = trLangs().map(l => {
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
  const inputs = trLangs().map(l => {
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
  const picked = new Set();
  let rows = [];

  const bar = h('div.row.wrap', { style: { gap: '6px' } });

  // توليدُ مصطلحاتٍ من المرشَّحين، ثم توجيهُها إن شاء (ملاحظة ٣٠٠)
  const promote = async (norms, dispatch) => {
    if (!norms.length) return toast('أشِّر لفظًا واحدًا على الأقل.', 'bad');
    let made = [];
    try { made = await db.rpc('promote_candidates', { p_norms: norms, p_category: 'عام' }) || []; }
    catch (e) { return toast(e.message, 'bad'); }
    toast(`وُلِّد ${made.length} مصطلحًا في الدليل.`, 'ok');
    picked.clear();
    await load(); if (onAdded) await onAdded();
    if (!dispatch || !made.length) return;

    const langBoxes = trLangs().filter(l => l.is_active).map(l => {
      const cb = h('input', { type: 'checkbox', value: l.code, 'aria-label': l.name_ar });
      return { code: l.code, cb, el: h('label.check.col-pick', cb, h('span', l.name_ar)) };
    });
    const note = h('textarea', { rows: 2, 'aria-label': 'توجيه' },
      'نأمل الدقةَ وتجويدَ الترجمة.');
    const due = h('input', { type: 'date', 'aria-label': 'الموعد' });
    const res = await dialog({
      title: `توجيهُ ${made.length} مصطلحًا إلى المترجمين`,
      body: h('div.stack',
        h('p.small.muted', 'تُنشأ لكلِّ لغةٍ مهمّةٌ تظهر للمترجم في «مهامي»، '
          + 'وما يكتبه يدخل الدليلَ معتمدًا.'),
        h('fieldset.stack', h('legend', 'اللغات'),
          h('div.col-picker', langBoxes.map(b => b.el))),
        h('label.field', 'توجيهٌ يظهر في رأس الجدول', note),
        h('label.field', 'الموعد (اختياري)', due)),
      buttons: [
        { label: 'أرسِل', kind: 'primary',
          validate: () => (langBoxes.some(b => b.cb.checked) ? true : 'اختر لغةً واحدةً على الأقل'),
          value: () => ({ langs: langBoxes.filter(b => b.cb.checked).map(b => b.code),
            note: note.value.trim(), due: due.value || null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      const out = await db.rpc('dispatch_glossary', {
        p_terms: made.map(m => m.term_id), p_langs: res.langs,
        p_assignees: {}, p_note: res.note || null, p_due: res.due });
      toast(`أُنشئت ${(out || []).length} مهمّةً.`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  const ignore = async norm => {
    try { await db.rpc('ignore_candidate', { p_norm: norm }); picked.delete(norm); await load(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  // تعديلُ اللفظ قبل توليده: المرصدُ يرصد والصياغةُ للإنسان
  const editOne = async c => {
    const t = h('input', { value: c.raw, 'aria-label': 'اللفظ' });
    const cat = h('select', { 'aria-label': 'التصنيف' },
      CATEGORIES.map(x => h('option', { value: x, selected: x === 'عام' }, x)));
    const res = await dialog({ title: 'تعديلُ اللفظ قبل توليده',
      body: h('div.stack', h('label.field', 'اللفظ', t), h('label.field', 'التصنيف', cat)),
      buttons: [{ label: 'ولِّدْه', kind: 'primary',
        validate: () => (t.value.trim().length >= 2 ? true : 'اكتب اللفظ'),
        value: () => ({ term: t.value.trim(), cat: cat.value }) }, { label: 'إلغاء', value: null }] });
    if (!res) return;
    try {
      await db.rpc('propose_glossary_term', { p: { term_ar: res.term, category: res.cat } });
      await db.rpc('ignore_candidate', { p_norm: c.norm });
      toast('أُضيف إلى الدليل.', 'ok');
      await load(); if (onAdded) await onAdded();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // أيقوناتٌ صغيرةٌ بحجم اللفظ: لا جدولٌ يُطيل الصفحة (ملاحظة ٢٩٧)
  const chip = c => {
    const on = picked.has(c.norm);
    const el = h('span.cand' + (on ? '.on' : ''), { title: `تكرّر ${c.hits} مرة في ${c.works} عمل` },
      h('button.cand-word', { type: 'button', 'aria-pressed': on ? 'true' : 'false' },
        h('b', c.raw), h('span.cand-n', String(c.hits))),
      h('button.cand-act', { type: 'button', title: 'ولِّدْه في الدليل',
        onclick: () => promote([c.norm], false) }, '✓'),
      h('button.cand-act', { type: 'button', title: 'عدّلْه ثم ولِّدْه',
        onclick: () => editOne(c) }, '✎'),
      h('button.cand-act', { type: 'button', title: 'ولِّدْه ووجِّهْه للترجمة',
        onclick: () => promote([c.norm], true) }, '⇄'),
      h('button.cand-act.ghost', { type: 'button', title: 'تجاهلْه',
        onclick: () => ignore(c.norm) }, '✕'));
    el.firstElementChild.onclick = () => {
      if (picked.has(c.norm)) picked.delete(c.norm); else picked.add(c.norm);
      paint();
    };
    return el;
  };

  const paint = () => {
    info.textContent = rows.length
      ? `${rows.length} مرشَّحًا ينتظر النظر — الأعلى تكرارًا أولًا.`
      : 'لا مرشَّحين. اضغط «ارصد الآن» ليمسح المرصدُ أصولَ الأرشيف.';
    box.replaceChildren(rows.length ? h('div.cand-wrap', rows.map(chip)) : null);
    genBtn.disabled = !picked.size;
    dispBtn.disabled = !picked.size;
    genBtn.textContent = picked.size ? `ولِّدْ المحدَّد (${picked.size})` : 'ولِّدْ المحدَّد';
  };

  const load = async () => {
    try {
      rows = await db.select('term_candidates',
        { select: '*', state: 'eq.new', order: 'hits.desc,works.desc', limit: 120 }) || [];
    } catch (e) { box.replaceChildren(h('p.small.warn', e.message)); return; }
    paint();
  };

  const genBtn = h('button.btn.sm.primary', { type: 'button', disabled: true }, 'ولِّدْ المحدَّد');
  genBtn.onclick = () => promote([...picked], false);
  const dispBtn = h('button.btn.sm', { type: 'button', disabled: true }, 'ولِّدْ ووجِّهْ');
  dispBtn.onclick = () => promote([...picked], true);
  const purgeBtn = h('button.btn.sm.ghost', { type: 'button' }, 'نقِّ المرصد');
  purgeBtn.onclick = () => busy(purgeBtn, async () => {
    try {
      const n = await db.rpc('purge_candidates');
      toast(n ? `أُخرج ${n} لفظًا موجودًا في الدليل.` : 'لا شيء يُنقَّى.', 'ok');
      await load();
    } catch (e) { toast(e.message, 'bad'); }
  });
  const scan = h('button.btn.sm', { type: 'button' }, '⟳ ارصد الآن');
  scan.onclick = () => busy(scan, async () => {
    try {
      const out = await db.rpc('scan_terms', { p_min_works: 2, p_max: 400 });
      const d = (Array.isArray(out) ? out[0] : out) || {};
      toast(`رُصد ${d.scanned || 0}، ونُقِّي ${d.purged || 0}، وينتظر ${d.pending || 0}.`, 'ok');
      await load();
    } catch (e) { toast(e.message, 'bad'); }
  });

  bar.append(genBtn, dispBtn, purgeBtn, scan);
  await load();
  return h('section.card.stack',
    h('div.row.between.wrap', h('h3', 'مرصد المصطلحات'), bar),
    h('p.small.muted', 'يمسح المرصدُ الأصولَ العربية في أرشيف الترجمة فيُخرج المتكرِّرَ من '
      + 'الألفاظ والتراكيب، الأعلى تكرارًا أولًا، ولا يعرض ما في الدليل أصلًا. '
      + 'وهو يَرصد ولا يُفتي: التوليدُ والتوجيهُ والتجاهلُ بيدك.'),
    info, box);
}

// ---------------------------------------------------------------------
// لوحةُ سير أعمال المصطلحات: ما وُجِّه، وكم أُنجز منه (ملاحظة ٣٠٠)
// ---------------------------------------------------------------------
async function boardCard() {
  let rows = [];
  try { rows = await db.rpc('glossary_task_board') || []; } catch { rows = []; }
  const pct = r => (r.total ? Math.round((r.done / r.total) * 100) : 0);
  const close = async r => {
    if (!await confirm(`إغلاقُ مهمّة ${r.language_name}؟`)) return;
    try { await db.rpc('close_glossary_task', { p_task: r.id }); toast('أُغلقت المهمّة.', 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
  };
  return h('section.card.stack',
    h('h3', 'سيرُ أعمال المصطلحات'),
    h('p.small.muted', 'ما وُجِّه إلى المترجمين من المصطلحات، وكم أُنجز منه في كلِّ لغة.'),
    rows.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['اللغة', 'المُسنَد إليه', 'الإنجاز', 'الموعد', ''].map(t => h('th', t)))),
      h('tbody', rows.map(r => h('tr', { class: r.closed_at ? 'muted' : '' },
        h('td', { 'data-label': 'اللغة' }, h('b', r.language_name)),
        h('td', { 'data-label': 'المُسنَد إليه' }, r.assignee),
        h('td', { 'data-label': 'الإنجاز' },
          h('span.badge' + (pct(r) === 100 ? '.ok' : ''), `${r.done}/${r.total} — ${pct(r)}٪`)),
        h('td', { 'data-label': 'الموعد' }, r.due_on ? fmtDate(r.due_on) : '—'),
        h('td', r.closed_at ? h('span.small.muted', 'مُغلقة')
          : isManager() ? h('button.btn.xs.ghost', { type: 'button', onclick: () => close(r) }, 'أغلِقها')
          : null))))))
      : h('p.small.muted', 'لم يُوجَّه شيءٌ بعد.'));
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

// ---------------------------------------------------------------------
// الاستيراد من ملف (ملاحظة ٢٤٤)
//   يقرأ شكلين: ورقةً واحدةً أعمدتُها اللغات، أو ورقةً لكلِّ لغةٍ يدلُّ
//   اسمُها على لسانها — وهو شكلُ القواميس. ويعرض ما فهمه قبل أن يُدخله.
// ---------------------------------------------------------------------
const arKey = s => String(s ?? '')
  .replace(/[ً-ْـ‏‎]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[^ء-ي\s]/g, ' ').replace(/\s+/g, ' ').trim();

const cell = v => String(v ?? '').replace(/[‏‎]/g, '').replace(/\s+/g, ' ').trim();

// رأسُ الورقة: يُبحث عنه في أول عشرة صفوف، ولا يُقبل إلا بمطابقةٍ
// تامّة — فالقواميسُ تضع فوق الرأس عنوانًا فيه كلمةُ «المصطلحات»، وكان
// الاحتواءُ يُوقِفنا عنده فلا نبلغ الرأسَ الحقيقي (ملاحظة ٢٥٧)
function findHead(rows) {
  const EXACT_TERM = ['المصطلح', 'المصطلح العربي', 'العربية', 'الكلمة', 'الكلمة العربية'];
  const EXACT_TR   = ['الترجمة', 'المقابل', 'المعنى'];
  let best = null;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = (rows[i] || []).map(cell);
    const eq = list => cells.some(c => list.includes(c));
    // درجةُ المطابقة: الرأسُ الذي فيه العمودان أولى من الذي فيه واحد
    const score = (eq(EXACT_TERM) ? 2 : 0) + (eq(EXACT_TR) ? 1 : 0);
    if (score && (!best || score > best.score)) best = { at: i, cells, score };
    if (score === 3) break;
  }
  return best;
}

export function parseGlossaryBook(book) {
  const sheets = [];        // تقريرٌ لكلِّ ورقة
  const terms = new Map();  // مفتاحُ المصطلح ← صفُّه

  const put = (termRaw, { category = '', explanation = '', code = null, tr = '' }) => {
    const term = cell(termRaw);
    if (!term) return false;
    const k = arKey(term);
    if (!k) return false;
    let row = terms.get(k);
    if (!row) { row = { term_ar: term, category: '', explanation: '', tr: {} }; terms.set(k, row); }
    if (category && !row.category) row.category = category;
    if (explanation && !row.explanation) row.explanation = explanation;
    if (code && tr) {
      const list = row.tr[code] || (row.tr[code] = []);
      if (!list.includes(tr)) list.push(tr);     // صياغتان للمصطلح نفسِه: تُجمعان
    }
    return true;
  };

  for (const sh of book) {
    const head = findHead(sh.rows);
    if (!head) { sheets.push({ name: sh.name, kind: 'skip', why: 'بلا رأسٍ معروف', count: 0 }); continue; }
    const body = sh.rows.slice(head.at + 1);
    const idx = t => head.cells.findIndex(c => c === t);

    const iTerm = idx('المصطلح');
    if (iTerm >= 0) {
      // الشكل أ: ورقةٌ واحدة، عمودٌ لكلِّ لغة
      const iCat = idx('التصنيف'), iExp = idx('الشرح');
      const cols = [];
      head.cells.forEach((c, i) => {
        if (i === iTerm || i === iCat || i === iExp) return;
        const code = langByName(c);
        if (code) cols.push([i, code]);
      });
      let n = 0;
      for (const r of body) {
        const t = cell(r[iTerm]);
        if (!t) continue;
        let ok = put(t, { category: iCat >= 0 ? cell(r[iCat]) : '',
          explanation: iExp >= 0 ? cell(r[iExp]) : '' });
        for (const [i, code] of cols) {
          const v = cell(r[i]);
          if (v) put(t, { code, tr: v });
        }
        if (ok) n++;
      }
      sheets.push({ name: sh.name, kind: 'cols', codes: cols.map(c => c[1]), count: n });
      continue;
    }

    // الشكل ب: ورقةٌ للغةٍ واحدة — «العربية» و«الترجمة»، واللغةُ من اسم الورقة
    const iAr = head.cells.findIndex(c => c.includes('العربية') || c.includes('العربي'));
    const iTr = head.cells.findIndex(c => c.includes('الترجمة') || c.includes('المقابل'));
    const code = langByName(sh.name);
    if (iAr < 0 || iTr < 0) {
      sheets.push({ name: sh.name, kind: 'skip', why: 'لم يُعرف عمودا العربية والترجمة', count: 0 });
      continue;
    }
    if (!code) {
      sheets.push({ name: sh.name, kind: 'nolang', why: 'لم يُعرف لسانُ الورقة من اسمها', count: 0 });
      continue;
    }
    let n = 0;
    for (const r of body) {
      const t = cell(r[iAr]);
      if (!t) continue;
      put(t, { code, tr: cell(r[iTr]) });
      n++;
    }
    sheets.push({ name: sh.name, kind: 'lang', codes: [code], count: n });
  }

  const codes = [...new Set(sheets.flatMap(s => s.codes || []))];
  return { sheets, codes, terms: [...terms.values()] };
}

async function importFile(file, reload) {
  const book = await readWorkbook(file);
  if (!book.length) return toast('الملف فارغ.', 'bad');
  const parsed = parseGlossaryBook(book);
  if (!parsed.terms.length) {
    return toast('لم يُعثر على مصطلحات — راجع رؤوس الأعمدة، أو نزّل النموذج.', 'bad');
  }

  // اختيارُ اللغات المرفوعة (ملاحظة ٢٤٤ ط)
  const boxes = parsed.codes.map(code => {
    const cb = h('input', { type: 'checkbox', value: code, checked: true, 'aria-label': langName(code) });
    const n = parsed.terms.filter(t => t.tr[code]?.length).length;
    return { code, cb, el: h('label.check.col-pick', cb, h('span', langName(code)), h('span.badge', String(n))) };
  });
  const modeAdd = h('input', { type: 'radio', name: 'gl-imp-mode', value: 'add', checked: true, 'aria-label': 'إضافة' });
  const modeRep = h('input', { type: 'radio', name: 'gl-imp-mode', value: 'replace', 'aria-label': 'استبدال' });

  const kindLabel = s => (s.kind === 'cols' ? `أعمدةُ لغات (${s.codes.length})`
    : s.kind === 'lang' ? langName(s.codes[0])
      : s.kind === 'nolang' ? 'لم يُعرف لسانُها' : 'تُخطّيت');

  const ok = await dialog({
    title: 'استيراد المصطلحات',
    body: h('div.stack',
      h('p', h('b', `${parsed.terms.length} مصطلحًا`), ` من ${book.length} ورقة، وفيها `,
        h('b', `${parsed.codes.length} لغة`), '.'),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['الورقة', 'ما فُهم منها', 'صفوف'].map(t => h('th', t)))),
        h('tbody', parsed.sheets.map(s => h('tr',
          h('td', { 'data-label': 'الورقة' }, s.name),
          h('td', { 'data-label': 'ما فُهم منها' },
            s.kind === 'skip' || s.kind === 'nolang'
              ? h('span.badge.warn', s.why) : kindLabel(s)),
          h('td', { 'data-label': 'صفوف' }, String(s.count))))))),
      h('fieldset.stack', h('legend', 'اللغات التي تُرفع'),
        h('div.col-picker', boxes.map(b => b.el))),
      h('fieldset.stack', h('legend', 'المقابلُ الموجودُ سلفًا'),
        h('label.check', modeAdd, h('span', 'أضِفْ ولا تمحُ — يبقى المقابلُ القديمُ حيث وُجد')),
        h('label.check', modeRep, h('span', 'استبدِلْ — يحلُّ مقابلُ الملفِ محلَّ القديم'))),
      h('p.small.muted', 'ما رُفع بملفٍّ يدخل الدليلَ معتمدًا — فالأصلُ فيه أنه مترجَمٌ مراجَع '
        + '(ملاحظة 259). والمصطلحُ المكرَّرُ بصياغتين تُجمع صياغتاه بينهما فاصلة.'),
      h('ul.small', parsed.terms.slice(0, 5).map(t => h('li', h('b', t.term_ar), ' — ',
        h('span.muted', Object.keys(t.tr).slice(0, 3).map(c => langName(c)).join(' · ') || 'بلا مقابل')))),
      parsed.terms.length > 5 ? h('p.small.muted', `… و${parsed.terms.length - 5} غيرها`) : null),
    buttons: [{ label: 'إلغاء', value: false }, { label: 'استيراد', kind: 'primary', value: true }]
  });
  if (!ok) return;

  const keep = boxes.filter(b => b.cb.checked).map(b => b.code);
  const rows = parsed.terms.map(t => ({
    term_ar: t.term_ar,
    category: t.category || '',
    explanation: t.explanation || '',
    translations: keep.filter(c => t.tr[c]?.length)
      .map(c => ({ language_code: c, term_tr: t.tr[c].join(' / ') }))
  }));

  // دفعاتٌ لئلّا ينقطع الطلبُ في منتصفه (ملاحظة ٢٤٤ هـ)
  const mode = modeRep.checked ? 'replace' : 'add';
  const sum = { added: 0, updated: 0, skipped: 0, translations: 0, bad_lang: 0 };
  const SIZE = 300;
  for (let i = 0; i < rows.length; i += SIZE) {
    const res = await db.rpc('import_glossary', { p_rows: rows.slice(i, i + SIZE), p_mode: mode });
    const r = (Array.isArray(res) ? res[0] : res) || {};
    for (const k of Object.keys(sum)) sum[k] += Number(r[k] || 0);
  }

  // تُحدَّث الشاشةُ قبل عرض التقرير، فيرى المستخدمُ أثرَه خلفَه لا بعدَه
  if (reload) await reload();

  await dialog({
    title: 'تقريرُ الاستيراد',
    body: h('div.stack',
      h('ul', h('li', `أُضيف: `, h('b', String(sum.added))),
        h('li', `حُدِّث: `, h('b', String(sum.updated))),
        h('li', `مقابلاتٌ كُتبت: `, h('b', String(sum.translations))),
        sum.skipped ? h('li', `تُخطّي: `, h('b', String(sum.skipped)), ' — صفوفٌ بلا مصطلحٍ عربي') : null,
        sum.bad_lang ? h('li', `لغاتٌ غيرُ مسجَّلة: `, h('b', String(sum.bad_lang))) : null),
      h('p.small.muted', 'دخل الجديدُ معتمدًا، فلا ينتظر اعتمادًا.')),
    buttons: [{ label: 'تمام', kind: 'primary', value: true }]
  });
}

// ---------------------------------------------------------------------
// الدليل: معجمٌ لا بطاقات (ملاحظات ٢٥٦ و٢٥٨ و٢٦٢)
//
//   الأساسُ المصطلحُ العربيُّ ومقابلُه في كلِّ لغة، يُعرَض صفوفًا
//   كالمعاجم: عمودان على الحاسب، وعمودٌ على الجوال، بصفٍّ فرديٍّ مميَّز.
//   ولكلٍّ نطاقُه: المترجمُ يرى لغاتِه وحدَها وأوّلُها لغتُه الأمّ،
//   والإدارةُ ترى اللغاتِ كلَّها. ولا تُعرض لمترجمٍ لغةٌ لم يسجّلها.
// ---------------------------------------------------------------------
export async function render(ctx) {
  const admin = isAdmin();
  const guide = await db.rpc('platform_guidance').catch(() => null);

  let langRows = [];
  try { langRows = await db.rpc('glossary_cards') || []; } catch { langRows = []; }

  // اللغةُ المعروضةُ أوّلَ ما تُفتح: لغتُه الأمُّ، وإلا أوّلُ لغاتِه،
  // وإلا أكثرُها مصطلحاتٍ للإدارة (ملاحظة ٢٥٦ ز)
  const firstLang = () => {
    const native = langRows.find(r => r.native);
    if (native) return native.code;
    const mine = langRows.filter(r => r.mine).sort((a, b) => b.done - a.done);
    if (mine.length) return mine[0].code;
    const any = [...langRows].sort((a, b) => b.done - a.done);
    return any.length ? any[0].code : '';
  };

  // اللغةُ تُؤخذ من المسار: الضغطُ على بطاقتها يدخل صفحتَها (ملاحظة ٢٩٥)
  const routed = (ctx?.params?.lang || '').trim();
  let lang = routed && langRows.some(r => r.code === routed) ? routed : (routed ? '' : firstLang());
  let showEmpty = false;
  let rows = [];                   // صفوفُ المعجم المعروضة
  let terms = [];                  // الصفوفُ الكاملةُ لعرض «كل اللغات»

  const q = h('input', { type: 'search', placeholder: 'ابحث في المصطلح ومقابله…',
    'aria-label': 'بحث في المعجم' });
  const cat = h('select', { 'aria-label': 'التصنيف' },
    h('option', { value: '' }, 'كل التصنيفات'),
    CATEGORIES.map(c => h('option', { value: c }, c)));
  const onlyMissing = h('input', { type: 'checkbox', 'aria-label': 'ما لا مقابل له' });

  const cards = h('div.lang-grid.gl-grid');
  const langBar = h('div.stack');
  const cardsBar = h('div.row.between.gl-bar');
  const letters = h('div.gl-letters');
  const table = h('div.gl-dict');
  const count = h('span.badge');

  // -------------------------------------------------------------
  // بطاقاتُ اللغات: العددُ فيها رقمٌ بارز (ملاحظة ٢٥٨)
  // -------------------------------------------------------------
  const mkCard = (r) => {
    const on = lang === r.code;
    const el = h('button.lang-card', {
      type: 'button',
      class: [r.is_core ? 'core' : '', on ? 'on' : '', (!r.done && !r.is_core) ? 'off' : '',
        r.native ? 'native' : ''].filter(Boolean).join(' '),
      title: on ? 'اضغط لعرض كل اللغات' : `اعرض معجم ${r.name_ar}`
    },
      h('div.row.between', h('b', r.name_ar),
        r.native ? h('span.badge.ok', 'لغتك الأمّ') : h('span.lang-code', { dir: 'ltr' }, r.code)),
      h('span.lang-native', { dir: r.dir || 'ltr' }, r.native_name || ''),
      h('div.lang-count',
        h('b', r.done ? String(r.done) : '0'),
        h('small', 'مصطلحًا')),
      // اللغةُ التي لم يُترجَم فيها شيءٌ بعد ليست «مكتملة» (ملاحظة ٢٧٨)
      r.missing ? h('span.badge.warn', `ينقص ${r.missing}`)
        : r.done ? h('span.badge.ok', 'مكتملة')
        : h('span.badge', 'لا مصطلحات بعد'));
    el.onclick = () => (ctx?.navigate
      ? ctx.navigate(on ? '/app/glossary' : `/app/glossary/${r.code}`)
      : (() => { lang = on ? '' : r.code; drawCards(); draw(); })());
    return el;
  };

  const drawCards = () => {
    const core = langRows.filter(r => r.is_core || r.native);
    const rest = langRows.filter(r => !(r.is_core || r.native)
      && (showEmpty || r.done > 0 || lang === r.code));
    const hidden = langRows.filter(r => !(r.is_core || r.native)).length - rest.length;

    const toggle = h('button.btn.xs' + (showEmpty ? '.primary' : '.ghost'), { type: 'button' },
      showEmpty ? 'أخفِ اللغات الفارغة' : `أظهر اللغات الفارغة${hidden ? ` (${hidden})` : ''}`);
    toggle.onclick = () => { showEmpty = !showEmpty; drawCards(); };

    const all = h('button.btn.xs' + (lang ? '' : '.primary'), { type: 'button' }, 'كلُّ اللغات');
    all.onclick = () => { lang = ''; drawCards(); draw(); };

    const add = h('button.btn.xs', { type: 'button' }, '＋ إضافة لغة');
    add.onclick = async () => {
      const sel = h('select', { 'aria-label': 'اللغة' },
        langRows.filter(r => !r.done).map(r => h('option', { value: r.code }, r.name_ar)));
      const ok = await dialog({
        title: 'افتح بطاقةَ لغة',
        body: h('div.stack',
          h('p.small.muted', 'تُفتح بطاقةُ اللغة فتُملأ مصطلحاتُها، وتبقى ظاهرةً بعد أول مصطلح. '
            + 'وإضافةُ لغةٍ جديدةٍ إلى المنصة من شاشة «اللغات».'),
          h('label.field', 'اللغة', sel)),
        buttons: [{ label: 'افتح', kind: 'primary', value: () => sel.value }, { label: 'إلغاء', value: null }]
      });
      if (!ok) return;
      lang = ok; showEmpty = true; drawCards(); draw();
    };

    cardsBar.replaceChildren(
      h('span.small.muted', lang ? `معجمُ ${langName(lang)}` : 'المعجمُ بكلِّ اللغات المتاحة لك'),
      h('div.row', all, toggle, add));
    cards.replaceChildren(...core.map(mkCard), ...rest.map(mkCard));
  };

  // -------------------------------------------------------------
  // المعجم: صفُّ مصطلحٍ ومقابلِه، بصفٍّ فرديٍّ مميَّز
  // -------------------------------------------------------------
  const dictRow = (r, i) => {
    const el = h('button.gl-entry', { type: 'button', class: i % 2 ? 'odd' : '' },
      h('span.gl-ar', r.term_ar),
      h('span.gl-sep', ':'),
      h('span.gl-tr', { dir: 'auto' }, r.term_tr || '—'),
      // «مقترح» علامةٌ صغيرةٌ لا تزاحم المدخل (ملاحظة ٢٥٦)
      r.status === 'مقترح' ? h('span.gl-dot', { title: 'مقترح — ينتظر الاعتماد' }, 'مقترح') : null);
    el.onclick = () => entryDialog(r);
    return el;
  };

  const drawLetters = () => {
    const seen = [...new Set(rows.map(r => r.letter).filter(Boolean))];
    letters.replaceChildren(...seen.map(L => {
      const b = h('button.gl-letter', { type: 'button' }, L);
      b.onclick = () => {
        const el = table.querySelector(`[data-letter="${CSS.escape(L)}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      return b;
    }));
  };

  // داخلَ اللغة: اسمُها وعددُ مصطلحاتها ومنها يُصدَر قاموسُها وحدَه
  //   بغلافه وحقوقه وفهرس حروفه (ملاحظة ٢٩٥)
  const drawLangBar = () => {
    const r = langRows.find(x => x.code === lang);
    if (!r) { langBar.replaceChildren(); return; }
    const issue = h('button.btn.sm.primary', { type: 'button' }, `⤓ إصدارُ قاموس ${r.name_ar}`);
    issue.onclick = () => busy(issue, () => issueLangDict(r));
    langBar.replaceChildren(h('div.card.row.between.wrap.gl-langbar',
      h('div.stack', { style: { gap: '2px' } },
        h('b', `معجمُ ${r.name_ar}`),
        h('span.small.muted', `${r.done} مصطلحًا مترجَمًا`
          + (r.missing ? ` · ينقصُ ${r.missing}` : ''))),
      h('div.row', { style: { gap: '6px' } },
        h('a.btn.sm.ghost', { href: '/app/glossary' }, 'كلُّ اللغات'), issue)));
  };

  // قاموسُ لغةٍ واحدةٍ: على هيئة المعاجم بغلاف الهيئة وصفحةِ الحقوق
  async function issueLangDict(r) {
    if (!terms.length) terms = await loadTerms();
    const pairs = terms
      .map(x => [x.term_ar, x.translations.find(t => t.language_code === r.code)?.term_tr || ''])
      .filter(x => x[1])
      .sort((a, b) => arBare(a[0]).localeCompare(arBare(b[0]), 'ar'));
    if (!pairs.length) return toast(`لا مقابلاتٍ في ${r.name_ar} بعد.`, 'bad');
    try {
      const { exportDictionary } = await import('../teamexport.js');
      const done = await exportDictionary([{ code: r.code, name: r.name_ar, pairs }],
        `الدليل الإرشادي للمصطلحات — ${r.name_ar}`,
        { note: 'الرجوع إليه إلزامي عند لبس المصطلح — كما في العقد.',
          cols: 3, pdf: true, letters: true, about: true });
      if (!done) return toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad');
      toast('جرى الإصدار.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function draw() {
    drawLangBar();
    table.replaceChildren(h('p.muted', 'يُحمَّل…'));
    if (!lang) return drawAll();
    try {
      rows = await db.rpc('glossary_dict', { p_lang: lang, p_q: q.value.trim() || null,
        p_category: cat.value || null, p_only_missing: !!onlyMissing.checked }) || [];
    } catch (err) { table.replaceChildren(h('p.muted', err.message)); return; }

    count.textContent = `${rows.length} مصطلحًا`;
    if (!rows.length) {
      table.replaceChildren(h('p.muted', 'لا مصطلح يطابق البحث.'));
      letters.replaceChildren();
      return;
    }
    // فواصلُ الحروف كما تفعل المعاجم
    const out = [];
    let last = null;
    rows.forEach((r, i) => {
      if (r.letter && r.letter !== last) {
        last = r.letter;
        out.push(h('div.gl-letter-head', { 'data-letter': r.letter }, r.letter));
      }
      out.push(dictRow(r, i));
    });
    table.replaceChildren(h('div.gl-cols', ...out));
    drawLetters();
  }

  // «كلُّ اللغات»: شبكةٌ كاملةٌ — المصطلحُ وعمودٌ لكلِّ لغةٍ متاحةٍ لك
  async function drawAll() {
    if (!terms.length) terms = await loadTerms();
    const codes = langRows.map(r => r.code);
    const s = q.value.trim().toLowerCase();
    const list = terms.filter(r => (!cat.value || r.category === cat.value)
      && (!s || matchTerm(r, s)));
    count.textContent = `${list.length} مصطلحًا`;
    letters.replaceChildren();
    if (!list.length) { table.replaceChildren(h('p.muted', 'لا مصطلح يطابق البحث.')); return; }
    const trOf = (r, c) => r.translations.find(t => t.language_code === c)?.term_tr || '';
    table.replaceChildren(h('div.table-wrap', h('table.responsive.gl-grid-table',
      h('thead', h('tr', h('th', 'المصطلح'), codes.map(c => h('th', langName(c))))),
      h('tbody', list.map(r => h('tr',
        h('td', { 'data-label': 'المصطلح' }, h('b', r.term_ar)),
        codes.map(c => h('td', { 'data-label': langName(c), dir: 'auto' }, trOf(r, c) || '—'))))))));
  }

  // -------------------------------------------------------------
  // نافذةُ المدخل: الشرحُ والتنقيحُ وسجلُّه (ملاحظتا ٢٥٦ و٢٦١)
  // -------------------------------------------------------------
  async function entryDialog(r) {
    const mayWrite = !!lang && langRows.some(x => x.code === lang && (x.mine || admin));
    const value = h('input', { value: r.term_tr || '', dir: 'auto', 'aria-label': 'المقابل' });
    const why = h('input', { 'aria-label': 'سببُ التنقيح', placeholder: 'معنًى أدقّ… (اختياري)' });
    const hist = h('div.stack.gl-hist');

    db.rpc('translation_history', { p_term: r.term_id, p_lang: lang }).then(list => {
      hist.replaceChildren(...((list || []).length
        ? [h('b.small', 'سجلُّ التنقيح'),
           ...list.map(x => h('p.small.muted',
             `${x.was ? `«${x.was}» ← ` : ''}«${x.became}» — ${x.by_name}، ${fmtDate(x.at)}`
             + (x.why ? ` (${x.why})` : '')))]
        : [h('p.small.muted', 'لم يُنقَّح بعد.')]));
    }).catch(() => {});

    const res = await dialog({
      title: r.term_ar,
      body: h('div.stack',
        r.category ? h('span.badge', r.category) : null,
        h('p.small', r.has_explanation ? '' : 'بلا شرحٍ مكتوب.'),
        mayWrite
          ? h('div.stack',
              h('label.field', `المقابل في ${langName(lang)}`, value),
              h('label.field', 'سببُ التنقيح', why),
              h('p.small.muted', guide || GUIDANCE))
          : h('p.small.muted', 'لا تُكتب الترجمةُ إلا في لغةٍ سجّلتها ضمن إتقانك.'),
        hist),
      buttons: [
        mayWrite ? { label: 'حفظ', kind: 'primary',
          value: () => ({ text: value.value.trim(), why: why.value.trim() }) } : null,
        admin ? { label: 'المعاني', value: 'senses' } : null,
        { label: 'إغلاق', value: null }
      ].filter(Boolean)
    });
    if (!res) return;
    if (res === 'senses') { await sensesDialog({ id: r.term_id, term_ar: r.term_ar }); return; }
    try {
      await db.rpc('set_translation', { p_term: r.term_id, p_lang: lang,
        p_text: res.text, p_why: res.why || null, p_task: null });
      toast('حُفظ المقابل.', 'ok');
      langRows = await db.rpc('glossary_cards').catch(() => langRows) || langRows;
      drawCards(); draw();
    } catch (err) { toast(err.message, 'bad'); }
  }

  const GUIDANCE = 'نأمل الدقّةَ وتجويدَ الترجمة. وما ظهر لك فيه معنًى أدقُّ فنقّحه، '
    + 'فالدليلُ يُجوَّد بتعاونكم، وما يُنقَّح محفوظُ الأثر.';

  // -------------------------------------------------------------
  // الأدوات: الإضافةُ والاستيرادُ والطلبُ والتصدير
  // -------------------------------------------------------------
  const reload = async () => {
    terms = await loadTerms();
    langRows = await db.rpc('glossary_cards').catch(() => langRows) || langRows;
    drawCards(); await draw();
  };

  const edit = async row => {
    const p = await termDialog(row);
    if (!p) return;
    try { await db.rpc('save_glossary_term', { p }); toast('حُفظ المصطلح.', 'ok'); await reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  const addBtn = h('button.btn.sm.primary', { type: 'button' }, '＋ إضافة مصطلح');
  addBtn.onclick = () => edit(null);

  const codes = () => trLangs().map(l => l.code);
  const headerRow = () => ['المصطلح', 'التصنيف', 'الشرح', ...trLangs().map(l => langName(l.code))];

  const tmplBtn = h('button.btn.sm', { type: 'button' }, '⤓ نموذج الاستيراد');
  tmplBtn.onclick = () => {
    const sample = [headerRow(),
      ['التقوى', 'عقدي', 'امتثال الأمر واجتناب النهي.',
        ...trLangs().map(l => (l.code === 'en' ? 'Taqwa (God-consciousness)' : ''))],
      ['الصلاة', 'فقهي', 'الفريضة ذات الأقوال والأفعال المفتتحة بالتكبير المختتمة بالتسليم.',
        ...trLangs().map(() => '')]];
    downloadBlob(buildXlsx(sample, { sheetName: 'المصطلحات', allText: true }),
      'نموذج الدليل الإرشادي للمصطلحات.xlsx');
    toast('نُزِّل النموذج — املأه ثم استورده.', 'ok');
  };

  const fileIn = h('input#gl-import-file', { type: 'file', accept: '.xlsx,.csv', hidden: true,
    'aria-label': 'ملف المصطلحات' });
  const impBtn = can('gl_import')
    ? h('button.btn.sm', { type: 'button' }, '⤒ استيراد من Excel') : null;
  if (impBtn) {
    impBtn.onclick = () => fileIn.click();
    fileIn.onchange = () => busy(impBtn, async () => {
      const file = fileIn.files[0];
      fileIn.value = '';
      if (!file) return;
      try { await importFile(file, reload); } catch (err) { toast(err.message, 'bad'); }
    });
  }

  // رفعُ كلماتٍ عربيةٍ وإسنادُها للمترجمين (ملاحظة ٢٦٠)
  const askFile = h('input#gl-ask-file', { type: 'file', accept: '.xlsx,.csv', hidden: true,
    'aria-label': 'ملف كلمات عربية' });
  const askBtn = can('gl_request')
    ? h('button.btn.sm', { type: 'button' }, '✎ طلبُ ترجمة') : null;
  if (askBtn) {
    askBtn.onclick = () => dispatchDialog();
    askFile.onchange = async () => {
      const file = askFile.files[0];
      askFile.value = '';
      if (!file) return;
      try { await uploadArabic(file); } catch (err) { toast(err.message, 'bad'); }
    };
  }

  const expBtn = h('button.btn.sm', { type: 'button' }, '⤓ تصدير الدليل');
  expBtn.onclick = () => busy(expBtn, () => exportGuide());

  // -------------------------------------------------------------
  // ما ينتظر الاعتماد
  // -------------------------------------------------------------
  const queue = h('div.stack');
  const drawQueue = async () => {
    if (!admin) { queue.replaceChildren(); return; }
    if (!terms.length) terms = await loadTerms();
    const pend = terms.filter(r => r.status === 'مقترح');

    // الاعتمادُ جملةً: المئاتُ لا تُعتمَد واحدًا واحدًا (ملاحظة ٢٧٧)
    const picked = new Set();
    const bulkBtn = h('button.btn.sm.primary', { type: 'button', disabled: true });
    const syncBulk = () => {
      bulkBtn.disabled = !picked.size;
      bulkBtn.textContent = picked.size ? `اعتمِد المحدَّد (${picked.size})` : 'اعتمِد المحدَّد';
    };
    const approveMany = ids => busy(bulkBtn, async () => {
      if (!ids.length) return;
      try {
        const n = await db.rpc('approve_glossary_terms', { p_ids: ids, p_on: true });
        toast(`اعتُمد ${n} مصطلحًا.`, 'ok'); picked.clear(); await reload(); drawQueue();
      } catch (e) { toast(e.message, 'bad'); }
    });
    bulkBtn.onclick = () => approveMany([...picked]);
    const allBtn = h('button.btn.sm', { type: 'button' }, `اعتمِد الكلَّ (${pend.length})`);
    allBtn.onclick = async () => {
      if (!await confirm(`اعتمادُ ${pend.length} مصطلحًا جملةً؟`)) return;
      approveMany(pend.map(r => r.id));
    };
    const pickAll = h('input', { type: 'checkbox', 'aria-label': 'تحديد الكل' });
    const boxOf = r => {
      const c = h('input', { type: 'checkbox', 'aria-label': `تحديد ${r.term_ar}` });
      c.onchange = () => { if (c.checked) picked.add(r.id); else picked.delete(r.id); syncBulk(); };
      return c;
    };
    const boxes = new Map(pend.map(r => [r.id, boxOf(r)]));
    pickAll.onchange = () => {
      picked.clear();
      for (const [id, c] of boxes) { c.checked = pickAll.checked; if (pickAll.checked) picked.add(id); }
      syncBulk();
    };
    syncBulk();

    // لافتةٌ سطرٌ واحد، والجدولُ يُفتح بنافذةٍ: فالمصطلحاتُ هي التي
    // تستحقُّ صدرَ الصفحة لا المقترحات (ملاحظة ٢٩٦)
    const tableEl = () => h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', h('th', pickAll), ['المصطلح', 'القسم', 'الشرح', ''].map(t => h('th', t)))),
        h('tbody', pend.map(r => h('tr',
          h('td', boxes.get(r.id)),
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
            } }, 'ردّ'))))))));

    const openBtn = h('button.btn.xs', { type: 'button' }, 'استعرِض');
    openBtn.onclick = () => dialog({ title: `مقترحاتٌ تنتظر النظر (${pend.length})`,
      body: h('div.stack',
        h('p.small.muted', 'ما اقترحه عضوٌ يدويًّا يُسجَّل «مقترحًا» حتى يُعتمد. '
          + 'وما رُفع بملفٍّ يدخل معتمدًا، فالأصلُ فيه أنه مترجَمٌ مراجَع.'),
        h('div.row', { style: { gap: '6px' } }, bulkBtn, allBtn),
        tableEl()),
      buttons: [{ label: 'إغلاق', value: null }] });

    queue.replaceChildren(pend.length
      ? h('div.card.row.between.wrap.gl-pend',
          h('span.small', h('b', `${pend.length}`), ' مقترحًا ينتظر النظر'),
          h('div.row', { style: { gap: '6px' } }, openBtn, allBtn))
      : null);
  };

  // -------------------------------------------------------------
  // رفعُ قائمةٍ عربيةٍ وإسنادُها (ملاحظة ٢٦٠)
  // -------------------------------------------------------------
  async function uploadArabic(file) {
    const book = await readWorkbook(file);
    const words = [];
    for (const sh of book) {
      for (const row of sh.rows || []) {
        const w = cell(row[0]);
        if (w && arKey(w) && !['المصطلح', 'الكلمة', 'العربية'].includes(w)) words.push(w);
      }
    }
    if (!words.length) return toast('لم يُعثر على كلماتٍ عربية في العمود الأول.', 'bad');
    const out = await db.rpc('import_arabic_terms', { p_words: words, p_category: 'عام' });
    const d = (Array.isArray(out) ? out[0] : out) || {};
    toast(`أُدخل ${d.added || 0} مصطلحًا، و${d.existed || 0} كان موجودًا.`, 'ok');
    await reload();
    return dispatchDialog();
  }

  async function dispatchDialog() {
    const all = await loadTerms();
    const boxes = new Map();
    const listBox = h('div.stack.gl-pick');
    const search = h('input', { type: 'search', placeholder: 'صفِّ القائمة…', 'aria-label': 'بحث' });

    const paint = () => {
      const s = search.value.trim();
      const shown = all.filter(r => !s || matchTerm(r, s));
      listBox.replaceChildren(...shown.slice(0, 500).map(r => {
        const cb = boxes.get(r.id) || h('input', { type: 'checkbox', 'aria-label': r.term_ar });
        boxes.set(r.id, cb);
        return h('label.check', cb, h('span', r.term_ar));
      }));
    };
    search.addEventListener('input', paint);
    paint();

    const pickAll = h('button.btn.xs', { type: 'button' }, 'أشِّر الكلّ');
    pickAll.onclick = () => { boxes.forEach(c => { c.checked = true; }); };
    const pickNone = h('button.btn.xs.ghost', { type: 'button' }, 'ألغِ');
    pickNone.onclick = () => { boxes.forEach(c => { c.checked = false; }); };

    const langBoxes = state.languages.filter(l => l.is_active).map(l => {
      const cb = h('input', { type: 'checkbox', value: l.code, 'aria-label': l.name_ar });
      return { code: l.code, cb, el: h('label.check.col-pick', cb, h('span', l.name_ar)) };
    });
    const note = h('textarea', { rows: 2, 'aria-label': 'توجيه' }, GUIDANCE);
    const due = h('input', { type: 'date', 'aria-label': 'الموعد' });

    const upBtn = h('button.btn.sm', { type: 'button' }, '⤒ ارفع قائمةً عربية');
    upBtn.onclick = () => askFile.click();

    const res = await dialog({
      title: 'طلبُ ترجمةِ مصطلحات',
      body: h('div.stack',
        h('p.small.muted', 'اختر المصطلحاتِ واللغاتِ، فتُنشأ لكلِّ لغةٍ مهمّةٌ تظهر للمترجم '
          + 'في «مهامي». وما يكتبه يدخل الدليلَ معتمدًا بلا مراجعة.'),
        h('div.row', upBtn),
        h('fieldset.stack', h('legend', 'المصطلحات'),
          h('div.row.between', search, h('div.row', pickAll, pickNone)),
          listBox),
        h('fieldset.stack', h('legend', 'اللغات'),
          h('div.col-picker', langBoxes.map(b => b.el))),
        h('label.field', 'توجيهٌ يظهر في رأس الجدول', note),
        h('label.field', 'الموعد (اختياري)', due)),
      buttons: [
        { label: 'أرسِل', kind: 'primary',
          validate: () => {
            if (![...boxes.values()].some(c => c.checked)) return 'أشِّر مصطلحًا واحدًا على الأقل';
            if (!langBoxes.some(b => b.cb.checked)) return 'اختر لغةً واحدةً على الأقل';
            return true;
          },
          value: () => ({
            terms: [...boxes].filter(([, c]) => c.checked).map(([id]) => id),
            langs: langBoxes.filter(b => b.cb.checked).map(b => b.code),
            note: note.value.trim(), due: due.value || null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      const out = await db.rpc('dispatch_glossary', { p_terms: res.terms, p_langs: res.langs,
        p_assignees: {}, p_note: res.note || null, p_due: res.due });
      const n = (out || []).length;
      toast(`أُنشئت ${n} مهمّةً — ${res.terms.length} مصطلحًا في كلٍّ منها.`, 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }

  // -------------------------------------------------------------
  // التصدير بهيئة المعاجم (ملاحظة ٢٦٢)
  // -------------------------------------------------------------
  async function exportGuide() {
    if (!terms.length) terms = await loadTerms();
    const avail = langRows.filter(l => terms.some(r =>
      r.translations.some(t => t.language_code === l.code && t.term_tr)));
    if (!avail.length) return toast('لا مقابلاتٍ لتُصدَّر.', 'bad');

    const boxes = avail.map(l => {
      const n = terms.filter(r => r.translations.some(t => t.language_code === l.code && t.term_tr)).length;
      const cb = h('input', { type: 'checkbox', value: l.code,
        checked: (!lang || lang === l.code) ? true : null, 'aria-label': l.name_ar });
      return { code: l.code, cb, el: h('label.check.col-pick', cb, h('span', l.name_ar), h('span.badge', String(n))) };
    });
    const all = h('button.btn.xs', { type: 'button', onclick: () => boxes.forEach(b => { b.cb.checked = true; }) }, 'كل اللغات');
    const none = h('button.btn.xs.ghost', { type: 'button', onclick: () => boxes.forEach(b => { b.cb.checked = false; }) }, 'ألغِ');

    const sort = h('select', { 'aria-label': 'الترتيب' },
      h('option', { value: 'ar' }, 'أبجديًّا بالعربية'),
      h('option', { value: 'tr' }, 'أبجديًّا بلغة الترجمة'),
      h('option', { value: 'as' }, 'كما أُدخل'));
    const cols = h('select', { 'aria-label': 'أعمدة الصفحة' },
      h('option', { value: '1' }, 'عمودٌ واحد'),
      h('option', { value: '2' }, 'عمودان'),
      h('option', { value: '3', selected: true }, 'ثلاثة أعمدة'));
    const fmt = h('select', { 'aria-label': 'الصيغة' },
      h('option', { value: 'pdf', selected: true }, 'PDF بهيئة المعاجم'),
      h('option', { value: 'docx' }, 'Word — مستند'),
      h('option', { value: 'xlsx' }, 'Excel — ورقةٌ لكلِّ لغة'));

    const res = await dialog({
      title: 'تصدير الدليل الإرشادي',
      body: h('div.stack',
        h('p.small.muted', 'يخرج المصطلحُ ومقابلُه لا غير، على هيئة المعاجم: أعمدةٌ في الصفحة، '
          + 'ورأسٌ فيه أوّلُ مدخلٍ وآخرُه، وفواصلُ الحروف.'),
        h('fieldset.stack', h('legend', 'اللغات'),
          h('div.row.between', h('span.small.muted', `${avail.length} لغةً فيها مقابلات`),
            h('div.row', all, none)),
          h('div.col-picker', boxes.map(b => b.el))),
        h('div.grid-2',
          h('label.field', 'الترتيب', sort),
          h('label.field', 'أعمدة الصفحة', cols),
          h('label.field', 'الصيغة', fmt))),
      buttons: [
        { label: 'صدّر', kind: 'primary',
          validate: () => (boxes.some(b => b.cb.checked) ? true : 'اختر لغةً واحدةً على الأقل'),
          value: () => ({ codes: boxes.filter(b => b.cb.checked).map(b => b.code),
            sort: sort.value, cols: Number(cols.value), fmt: fmt.value }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;

    const title = 'الدليل الإرشادي للمصطلحات';
    const note = 'الرجوع إليه إلزامي عند لبس المصطلح — كما في العقد.';
    const pairs = code => {
      const out = terms
        .map(r => [r.term_ar, r.translations.find(t => t.language_code === code)?.term_tr || ''])
        .filter(p => p[1]);
      // الترتيبُ بالجذر لا بـ«ال» التعريف، كما تفعل المعاجم (ملاحظة ٢٦٢)
      if (res.sort === 'ar') out.sort((a, b) => arBare(a[0]).localeCompare(arBare(b[0]), 'ar'));
      if (res.sort === 'tr') out.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      return out;
    };

    try {
      if (res.fmt === 'xlsx') {
        const sheets = res.codes.map(c => ({
          name: langName(c),
          rows: [['المصطلح', langName(c)], ...pairs(c)]
        }));
        downloadBlob(buildXlsxBook(sheets, { allText: true }),
          `${title}${res.codes.length === 1 ? ` — ${langName(res.codes[0])}` : ''}.xlsx`);
      } else {
        const { exportDictionary } = await import('../teamexport.js');
        const parts = res.codes.map(c => ({ code: c, name: langName(c), pairs: pairs(c) }));
        const done = await exportDictionary(parts, title,
          { note, cols: res.cols, pdf: res.fmt === 'pdf', letters: res.sort === 'ar' });
        if (!done) return toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }

  q.addEventListener('input', () => draw());
  cat.addEventListener('change', () => draw());
  onlyMissing.addEventListener('change', () => draw());

  drawCards();
  await draw();
  drawQueue();

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        expBtn, tmplBtn, impBtn, fileIn, askBtn, askFile, addBtn),
      h('div.grow', h('div.eyebrow', 'المرجع'), h('h1', 'الدليل الإرشادي للمصطلحات'),
        h('p.muted', 'مصطلحٌ واحد ومقابلٌ واحد في كل لغة، فلا يختلف المترجمون في لفظٍ شرعي. '
          + 'والرجوع إليه إلزامي عند لبس المصطلح.'))),
    h('div.tabs',
      h('button.tab', { type: 'button', 'aria-selected': 'true' }, 'الدليل'),
      h('a.tab', { href: '/app/glossary/watch', 'aria-selected': 'false' }, 'مرصد المصطلحات')),
    cardsBar,
    cards,
    langBar,
    queue,
    h('div.card.stack',
      h('div.row.between', h('b', 'المصطلحات'), count),
      q,
      h('div.grid-2',
        h('label.field', 'التصنيف', cat),
        h('label.check', onlyMissing, h('span', 'ما لا مقابلَ له في هذه اللغة'))),
      letters,
      table),
    h('div.card.stack.gl-open',
      h('b', 'الدليل يُبنى بالفريق كله'),
      h('p.small.muted', 'لكل عضو أن يضيف مصطلحًا، ولكلِّ مترجمٍ أن يكتب المقابلَ في لغته '
        + 'ويُنقّح ما ظهر له فيه معنًى أدقّ — وما يُنقَّح محفوظُ الأثر. '
        + 'وما رُفع بملفٍّ بلغتين يدخل معتمدًا، فالأصلُ فيه أنه مترجَمٌ مراجَع.')));
}

// مرصد المصطلحات وسجلُّ المشاركة في تبويبٍ مستقل (ملاحظة ٢٥٦)
export async function watch() {
  const box = h('div.stack');
  const page = h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'المرجع'), h('h1', 'مرصد المصطلحات'),
        h('p.muted', 'يمسح المرصدُ أصولَ الأرشيف العربية فيُخرج المتكرِّرَ من الألفاظ، '
          + 'ثم يُضاف ما يُختار منها إلى الدليل.'))),
    h('div.tabs',
      h('a.tab', { href: '/app/glossary', 'aria-selected': 'false' }, 'الدليل'),
      h('button.tab', { type: 'button', 'aria-selected': 'true' }, 'مرصد المصطلحات')),
    box);

  (async () => {
    try {
      if (isAdmin()) box.append(await observatoryCard(() => {}));
      if (isAdmin()) box.append(await boardCard());
      box.append(await contribCard());
    } catch (err) { box.append(h('p.muted', err.message)); }
  })();

  return page;
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
    title: 'الدليل الإرشادي للمصطلحات',
    body: h('div.stack', q, out,
      h('p.small.muted', 'الرجوع إلى الدليل إلزامي عند لبس المصطلح، كما في العقد.')),
    buttons: [{ label: 'إغلاق', value: null }]
  });
}
