// الدليل المصطلحي الشرعي الموحَّد — التزامٌ في العقد (ملاحظة ١٥٠)
//   مصطلحٌ عربي، وشرحٌ يوضّح معناه الشرعي، ومقابله المعتمد في كل لغة.
//   الرجوع إليه إلزامي عند لبس المصطلح.
import { h, dialog, toast, busy, fmtDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { state, langName, langByName, isAdmin, isManager } from '../store.js';
import { icon } from '../icons.js';
import { buildXlsx, buildXlsxBook, downloadBlob, readWorkbook } from '../xlsx.js';

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

// رأسُ الورقة: يُبحث عنه في أول ستة صفوف، فالقواميسُ تضع عنوانًا فوقه
function findHead(rows) {
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const cells = (rows[i] || []).map(cell);
    const has = t => cells.some(c => c === t || c.includes(t));
    if (has('المصطلح') || (has('العربية') && has('الترجمة'))) {
      return { at: i, cells };
    }
  }
  return null;
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
      h('p.small.muted', 'الجديدُ يُضاف بحال «مقترح» حتى تعتمده الإدارة. '
        + 'والمصطلحُ المكرَّرُ بصياغتين تُجمع صياغتاه بينهما فاصلة.'),
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
      h('p.small.muted', 'الجديدُ بحال «مقترح» — يظهر في «مقترحاتٌ تنتظر النظر».')),
    buttons: [{ label: 'تمام', kind: 'primary', value: true }]
  });
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
    downloadBlob(buildXlsx(rows, { sheetName: 'المصطلحات', allText: true }), 'نموذج الدليل الإرشادي للمصطلحات.xlsx');
    toast('نُزِّل النموذج — املأه ثم استورده.', 'ok');
  };

  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true, 'aria-label': 'ملف المصطلحات' });
  const impBtn = h('button.btn.sm', { type: 'button' }, '⤒ استيراد من Excel');
  impBtn.onclick = () => fileIn.click();
  fileIn.onchange = () => busy(impBtn, async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    try { await importFile(file, reload); } catch (err) { toast(err.message, 'bad'); }
  });

  // ---------------- التصدير (ملاحظة ٢٤٥ ج) ----------------
  //   المصطلحُ ومقابلُه لا غير — فالدليلُ يُقرأ لا يُدار. ولغةٌ أو بعضٌ
  //   أو الكلُّ، وورقةٌ لكلِّ لغة، وجدولٌ أو سطور، وعددُ أعمدةِ الصفحة.
  const expBtn = h('button.btn.sm', { type: 'button' }, '⤓ تصدير الدليل');
  expBtn.onclick = () => busy(expBtn, () => exportGuide(filtered()));
  const exportGuide = async (rows) => {
    const avail = state.languages.filter(l => rows.some(r =>
      r.translations.some(t => t.language_code === l.code && t.term_tr)));
    if (!avail.length) return toast('لا مقابلاتٍ في المعروض لتُصدَّر.', 'bad');

    const boxes = avail.map(l => {
      const n = rows.filter(r => r.translations.some(t => t.language_code === l.code && t.term_tr)).length;
      const cb = h('input', { type: 'checkbox', value: l.code,
        checked: (!f.lang.value || f.lang.value === l.code) ? true : null, 'aria-label': l.name_ar });
      return { code: l.code, cb, el: h('label.check.col-pick', cb, h('span', l.name_ar), h('span.badge', String(n))) };
    });
    const all = h('button.btn.xs', { type: 'button', onclick: () => boxes.forEach(b => { b.cb.checked = true; }) }, 'كل اللغات');
    const none = h('button.btn.xs.ghost', { type: 'button', onclick: () => boxes.forEach(b => { b.cb.checked = false; }) }, 'ألغِ');

    const shape = h('select', { 'aria-label': 'شكل العرض' },
      h('option', { value: 'table' }, 'جدول — عمودان: العربية والمقابل'),
      h('option', { value: 'lines' }, 'سطور — المصطلح — المقابل'));
    const cols = h('select', { 'aria-label': 'أعمدة الصفحة' },
      h('option', { value: '1' }, 'عمودٌ واحد'),
      h('option', { value: '2', selected: true }, 'عمودان'),
      h('option', { value: '3' }, 'ثلاثة أعمدة'));
    const fmt = h('select', { 'aria-label': 'الصيغة' },
      h('option', { value: 'xlsx' }, 'Excel — ورقةٌ لكلِّ لغة'),
      h('option', { value: 'docx' }, 'Word — مستند'),
      h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));

    const res = await dialog({
      title: 'تصدير الدليل الإرشادي',
      body: h('div.stack',
        h('p.small.muted', 'يخرج المصطلحُ ومقابلُه لا غير — بلا تصنيفٍ ولا شرحٍ ولا حال.'),
        h('fieldset.stack', h('legend', 'اللغات'),
          h('div.row.between', h('span.small.muted', `${avail.length} لغةً فيها مقابلات`),
            h('div.row', all, none)),
          h('div.col-picker', boxes.map(b => b.el))),
        h('div.grid-2',
          h('label.field', 'شكل العرض', shape),
          h('label.field', 'أعمدة الصفحة', cols),
          h('label.field', 'الصيغة', fmt))),
      buttons: [
        { label: 'صدّر', kind: 'primary',
          validate: () => (boxes.some(b => b.cb.checked) ? true : 'اختر لغةً واحدةً على الأقل'),
          value: () => ({ codes: boxes.filter(b => b.cb.checked).map(b => b.code),
            shape: shape.value, cols: Number(cols.value), fmt: fmt.value }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;

    const title = 'الدليل الإرشادي للمصطلحات';
    const note = 'الرجوع إليه إلزامي عند لبس المصطلح — كما في العقد.';
    const pairs = code => rows
      .map(r => [r.term_ar, r.translations.find(t => t.language_code === code)?.term_tr || ''])
      .filter(p => p[1]);

    try {
      if (res.fmt === 'xlsx') {
        const sheets = res.codes.map(c => ({
          name: langName(c),
          rows: [['المصطلح', langName(c)], ...pairs(c)]
        }));
        downloadBlob(buildXlsxBook(sheets, { allText: true }),
          `${title}${res.codes.length === 1 ? ` — ${langName(res.codes[0])}` : ''}.xlsx`);
      } else {
        const { exportGuideDoc } = await import('../teamexport.js');
        const parts = res.codes.map(c => ({ code: c, name: langName(c), pairs: pairs(c) }));
        const done = await exportGuideDoc(parts, title,
          { note, shape: res.shape, cols: res.cols, pdf: res.fmt === 'pdf' });
        if (!done) return toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };

  // ---------------- بطاقاتُ اللغات (ملاحظتا ٢٣٤ و٢٤٥) ----------------
  // الأساسيةُ ظاهرةٌ دائمًا، وما سواها لا يظهر إلا بمصطلحاته. وبتصميم
  // شاشة «اللغات» نفسِه: الاسمُ بالعربية وتحتَه اسمُها بلسانها.
  const cards = h('div.lang-grid.gl-grid');
  const cardsBar = h('div.row.between.gl-bar');
  let langRows = [];
  let showEmpty = false;

  const mkCard = (r) => {
    const on = f.lang.value === r.code;
    const el = h('button.lang-card', {
      type: 'button',
      class: [r.is_core ? 'core' : '', on ? 'on' : '', (!r.done && !r.is_core) ? 'off' : ''].filter(Boolean).join(' '),
      title: on ? 'اضغط لإلغاء التصفية' : `اعرض مصطلحات ${r.name_ar}`
    },
      h('div.row.between', h('b', r.name_ar), h('span.lang-code', { dir: 'ltr' }, r.code)),
      h('span.lang-native', { dir: r.dir || 'ltr' }, r.native_name || ''),
      h('div.row.between',
        r.done ? h('span.small.muted', `${r.done} مصطلحًا`) : h('span.small.muted', 'لا مصطلح بعد'),
        r.missing ? h('span.badge.warn', `ينقص ${r.missing}`)
          : h('span.badge' + (r.done ? '.ok' : ''), r.done ? 'مكتملة' : '—')));
    el.onclick = () => {
      f.lang.value = on ? '' : r.code;
      drawCards(); draw();
    };
    return el;
  };

  const drawCards = () => {
    const core = langRows.filter(r => r.is_core);
    const rest = langRows.filter(r => !r.is_core && (showEmpty || r.done > 0 || f.lang.value === r.code));
    const hidden = langRows.filter(r => !r.is_core).length - rest.length;

    const toggle = h('button.btn.xs' + (showEmpty ? '.primary' : '.ghost'), { type: 'button' },
      showEmpty ? 'أخفِ اللغات الفارغة' : `أظهر اللغات الفارغة${hidden ? ` (${hidden})` : ''}`);
    toggle.onclick = () => { showEmpty = !showEmpty; drawCards(); };

    const add = h('button.btn.xs', { type: 'button' }, '＋ إضافة لغة');
    add.onclick = async () => {
      const sel = h('select', { 'aria-label': 'اللغة' },
        langRows.filter(r => !r.is_core && !r.done).map(r => h('option', { value: r.code }, r.name_ar)));
      const ok = await dialog({
        title: 'افتح بطاقةَ لغة',
        body: h('div.stack',
          h('p.small.muted', 'تُفتح بطاقةُ اللغة فتُملأ مصطلحاتُها، وتبقى ظاهرةً بعد أول مصطلح. '
            + 'وإضافةُ لغةٍ جديدةٍ إلى المنصة من شاشة «اللغات».'),
          h('label.field', 'اللغة', sel)),
        buttons: [{ label: 'افتح', kind: 'primary', value: () => sel.value }, { label: 'إلغاء', value: null }]
      });
      if (!ok) return;
      f.lang.value = ok; showEmpty = true; drawCards(); draw();
    };

    cardsBar.replaceChildren(
      h('span.small.muted', `${core.length + rest.length} لغةً معروضة`
        + (f.lang.value ? ` — التصفيةُ على ${langName(f.lang.value)}` : '')),
      h('div.row', toggle, add));
    cards.replaceChildren(...core.map(mkCard), ...rest.map(mkCard));
  };

  db.rpc('glossary_cards').then(rows => { langRows = rows || []; drawCards(); }).catch(() => {});

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
        expBtn, tmplBtn, impBtn, fileIn, addBtn),
      h('div.grow', h('div.eyebrow', 'المرجع'), h('h1', 'الدليل الإرشادي للمصطلحات'),
        h('p.muted', 'مصطلحٌ واحد ومقابلٌ واحد في كل لغة، فلا يختلف المترجمون في لفظٍ شرعي. '
          + 'والرجوع إليه إلزامي عند لبس المصطلح.'))),
    h('div.card.stack.gl-open',
      h('b', 'الدليل يُبنى بالفريق كله'),
      h('p.small.muted', 'لكل عضو أن يضيف مصطلحًا أو يستورد ملفًّا، ويُحفظ بحال «مقترح» '
        + 'حتى يعتمده المنسق أو مدير المشروع فيصير هو المعتمد. '
        + 'والاستيرادُ يقبل شكلين: ورقةً واحدةً أعمدتُها اللغات، أو ورقةً لكلِّ لغةٍ '
        + 'يدلُّ اسمُها على لسانها — وهو شكلُ القواميس.')),
    cardsBar,
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
    title: 'الدليل الإرشادي للمصطلحات',
    body: h('div.stack', q, out,
      h('p.small.muted', 'الرجوع إلى الدليل إلزامي عند لبس المصطلح، كما في العقد.')),
    buttons: [{ label: 'إغلاق', value: null }]
  });
}
