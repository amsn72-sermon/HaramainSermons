// الدليل المصطلحي الشرعي الموحَّد — التزامٌ في العقد (ملاحظة ١٥٠)
//   مصطلحٌ عربي، وشرحٌ يوضّح معناه الشرعي، ومقابله المعتمد في كل لغة.
//   الرجوع إليه إلزامي عند لبس المصطلح.
import { h, dialog, toast, busy, fmtDate, req, markBad } from '../ui.js';
import { db } from '../sb.js';
import { state, langName, isAdmin } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';

export const CATEGORIES = ['عقدي', 'فقهي', 'دعوي', 'عام'];

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

  draw();

  return h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, fmtSel, expBtn, addBtn),
      h('div.grow', h('div.eyebrow', 'المرجع'), h('h1', 'الدليل المصطلحي الشرعي'),
        h('p.muted', 'مصطلحٌ واحد ومقابلٌ واحد في كل لغة، فلا يختلف المترجمون في لفظٍ شرعي. '
          + 'والرجوع إليه إلزامي عند لبس المصطلح.'))),
    h('div.card.stack',
      h('div.row.between', h('b', 'البحث'), count),
      f.q,
      h('div.grid-2',
        h('label.field', 'التصنيف', f.cat),
        h('label.field', 'اللغة', f.lang),
        h('label.field', 'الحال', f.status))),
    list);
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
