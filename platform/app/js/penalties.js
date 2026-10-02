// جزاءاتُ العقد — تُعرض داخل «بنود العقد والمستخلص» لمدير المشروع (ملاحظة ١٩٧)
//   يفرض العقد غرامةً على التأخير والتقصير، لكلِّ نوعٍ مقدارُه: نسبةٌ من قيمة
//   الخطبة أو الترجمة، أو مبلغٌ مقطوع عن اليوم أو الساعة أو اللغة. ولا يتجاوز
//   مجموعُها عشرين في المئة من القيمة الإجمالية للعقد. فتُسجَّل الواقعةُ
//   بتاريخها ومادتها ولغتها، وتحتسب المنصة مقدارَها من الجدول، ويبقى للمدير
//   تثبيتُ غيره بسببٍ مكتوب، ويُنبَّه إذا قارب المجموعُ السقف.
import { h, toast, confirm, dialog, req, fmtDate } from './ui.js';
import { db } from './sb.js';
import { buildXlsx, downloadBlob } from './xlsx.js';

const STATE = {
  draft:    { label: 'مسودّة',   cls: '',      hint: 'سُجِّلت ولم تُبلَّغ بعد' },
  notified: { label: 'مُبلَّغة',  cls: 'warn',  hint: 'أبلغت بها الهيئة' },
  settled:  { label: 'مُسوّاة',  cls: 'bad',   hint: 'حُسمت أو سُوّيت' },
  waived:   { label: 'مُسقَطة',  cls: 'ok',    hint: 'أسقطتها الهيئة فلا تُحتسب' }
};

const BASIS_HINT = {
  sermon_value:      'نسبةٌ من قيمة الخطبة — اكتب قيمة الخطبة أو اتركها فيُؤخذ سعرُ العقد',
  task_value:        'نسبةٌ من قيمة الخطبة أو الترجمة — اكتب قيمتها أو اتركها فيُؤخذ سعرُ العقد',
  translation_value: 'نسبةٌ من إجمالي قيمة الترجمة — اكتب قيمتها',
  purchase_value:    'نسبةٌ من قيمة المشتريات محل التقصير — اكتب قيمتها',
  fixed:             'مبلغٌ مقطوع من العقد، يُضرب في عدد الوحدات'
};

export async function penaltySection() {
  const box = h('div.stack');
  const n2 = v => Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let kinds = [];
  let langs = [];

  // ---------- واقعةٌ تُسجَّل أو تُعدَّل ----------
  const itemDialog = async (row = null) => {
    const kindSel = h('select', { 'aria-label': 'نوع المخالفة' },
      kinds.map(k => h('option', { value: String(k.code),
        selected: row ? row.kind_code === k.code : false }, k.name)));
    const f = {
      on: h('input', { type: 'date', max: new Date().toISOString().slice(0, 10),
        value: row?.happened_on || new Date().toISOString().slice(0, 10),
        'aria-label': 'تاريخ الواقعة' }),
      units: h('input', { type: 'number', min: 0.5, max: 9999, step: 0.5,
        value: row?.units ?? 1, 'aria-label': 'عدد الوحدات' }),
      base: h('input', { type: 'number', min: 0, step: 0.01,
        value: row?.base_amount ?? '', placeholder: 'يُؤخذ من بنود العقد',
        'aria-label': 'القيمة التي تُحتسب عليها' }),
      amount: h('input', { type: 'number', min: 0, step: 0.01,
        value: row?.is_manual ? Number(row.amount) : '',
        placeholder: 'يُحتسب من الجدول', 'aria-label': 'المقدار' }),
      lang: h('select', { 'aria-label': 'اللغة' },
        h('option', { value: '' }, '— لا لغةَ بعينها —'),
        langs.map(l => h('option', { value: l.code,
          selected: row?.lang_code === l.code }, l.name_ar))),
      note: h('input', { value: row?.note || '', 'aria-label': 'بيان الواقعة' })
    };

    const hint = h('p.small.muted');
    const calc = h('p.small');
    const kindOf = () => kinds.find(k => String(k.code) === kindSel.value) || kinds[0];

    const refresh = async () => {
      const k = kindOf();
      if (!k) return;
      hint.replaceChildren(h('span', `${k.description} — الجزاء ${k.per_label}: `),
        h('b', k.basis === 'fixed' ? `${n2(k.amount)} ريال` : `${k.rate}٪`),
        h('br'), h('span.muted', BASIS_HINT[k.basis] || ''));
      f.base.disabled = k.basis === 'fixed';
      try {
        const v = await db.rpc('penalty_amount', {
          p_kind: k.code,
          p_units: Number(f.units.value) || 0,
          p_base: f.base.value === '' ? null : Number(f.base.value)
        });
        calc.replaceChildren(h('span', 'المحتسَب من جدول العقد: '),
          h('b', { dir: 'ltr' }, n2(v)), h('span', ' ريال'));
      } catch { calc.replaceChildren(h('span.muted', 'تعذّر الاحتساب.')); }
    };
    kindSel.onchange = refresh;
    f.units.oninput = refresh;
    f.base.oninput = refresh;
    await refresh();

    const res = await dialog({
      title: row ? 'تعديل الواقعة' : 'واقعةُ جزاء',
      body: h('div.stack',
        h('p.small.muted', 'تُسجَّل الواقعة كما وقعت، ويحتسب المقدارُ من جدول العقد. '
          + 'وما أُثبت بغير المحتسَب يحتاج سببًا مكتوبًا، ويُعلَم في الكشف.'),
        h('label.field', req('نوع المخالفة'), kindSel),
        hint,
        h('div.grid-2',
          h('label.field', req('تاريخ الواقعة'), f.on),
          h('label.field', req('عدد الوحدات'),
            h('small', kindOf()?.per_label || ''), f.units),
          h('label.field', 'القيمة التي تُحتسب عليها', f.base),
          h('label.field', 'اللغة', f.lang)),
        calc,
        h('label.field', 'المقدار المثبت',
          h('small', 'اتركه فارغًا ليُؤخذ المحتسَب، واكتبه مع سببٍ إن خالفتَه'),
          f.amount),
        h('label.field', 'بيان الواقعة أو سببُ المقدار المثبت', f.note)),
      buttons: [
        { label: row ? 'حفظ' : 'تسجيل الواقعة', kind: 'primary',
          validate: () => {
            if (!f.on.value) return 'اكتب تاريخ الواقعة';
            if (f.on.value > new Date().toISOString().slice(0, 10))
              return 'تاريخ الواقعة لا يكون في المستقبل';
            if (!(Number(f.units.value) > 0)) return 'عدد الوحدات واحدٌ فأكثر';
            if (f.amount.value !== '' && !f.note.value.trim())
              return 'اكتب سبب تثبيت مقدارٍ غير المحتسَب';
            return true;
          },
          value: () => ({
            id: row?.id ?? null, kind_code: Number(kindSel.value),
            happened_on: f.on.value, units: Number(f.units.value),
            base_amount: f.base.value === '' ? null : Number(f.base.value),
            amount: f.amount.value === '' ? null : Number(f.amount.value),
            lang_code: f.lang.value || null,
            note: f.note.value.trim() || null
          }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('save_penalty', { p: res });
      toast(row ? 'حُفظت الواقعة.' : 'سُجِّلت الواقعة.', 'ok');
      draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // ---------- الحالة ----------
  const stateDialog = async r => {
    const sel = h('select', { 'aria-label': 'الحالة' },
      Object.entries(STATE).map(([k, v]) =>
        h('option', { value: k, selected: r.state === k }, v.label)));
    const note = h('input', { value: '', 'aria-label': 'السبب' });
    const res = await dialog({
      title: 'حالةُ الواقعة',
      body: h('div.stack',
        h('p.small.muted', Object.entries(STATE)
          .map(([, v]) => `${v.label}: ${v.hint}`).join(' · ')),
        h('label.field', 'الحالة', sel),
        h('label.field', 'السبب', h('small', 'لازمٌ عند الإسقاط'), note)),
      buttons: [
        { label: 'حفظ', kind: 'primary',
          validate: () => (sel.value === 'waived' && !note.value.trim())
            ? 'اكتب سبب الإسقاط' : true,
          value: () => ({ state: sel.value, note: note.value.trim() || null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('set_penalty_state', { p_id: r.id, p_state: res.state, p_note: res.note });
      toast('حُفظت الحالة.', 'ok');
      draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const removeItem = async r => {
    if (!await confirm('حذف الواقعة',
      'تُحذف الواقعة من الكشف. وما خرج من المسودّة لا يُحذف وإنما يُسقَط بسببٍ مكتوب.',
      'حذف', 'bad')) return;
    try { await db.rpc('delete_penalty', { p_id: r.id }); toast('حُذفت الواقعة.', 'ok'); draw(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  // ---------- الرسم ----------
  async function draw() {
    box.replaceChildren(h('p.small.muted', 'جارٍ التحميل…'));
    let rows = [];
    let cap = null;
    try {
      [kinds, rows, cap, langs] = await Promise.all([
        db.select('penalty_kinds', { select: '*', order: 'sort' }),
        db.rpc('penalty_report'),
        db.rpc('penalty_cap'),
        db.select('languages', { select: 'code,name_ar', order: 'sort' })
      ]);
    } catch (e) { box.replaceChildren(h('p.small.bad', e.message)); return; }
    kinds = (Array.isArray(kinds) ? kinds : []).filter(k => k.is_active !== false);
    rows = Array.isArray(rows) ? rows : [];
    langs = Array.isArray(langs) ? langs : [];

    if (!kinds.length) {
      box.replaceChildren(h('p.muted', 'جزاءاتُ العقد لمدير المشروع.'));
      return;
    }

    const addBtn = h('button.btn.sm.primary', { type: 'button',
      onclick: () => itemDialog(null) }, '＋ واقعة');

    // ---------- السقف: عشرون في المئة من قيمة العقد ----------
    const capPct = cap ? Number(cap.used_pct || 0) : 0;
    const capCard = cap ? h('section.card.stack.cap-card',
      h('div.row.between',
        h('div', h('h3', 'سقفُ الغرامات'),
          h('p.small.muted', { style: { margin: 0 } },
            `لا يتجاوز إجماليُّ الغرامات ${cap.cap_pct}٪ من القيمة الإجمالية للعقد.`)),
        h('span.badge', { class: cap.over ? 'bad' : (cap.near ? 'warn' : 'gold') },
          `${capPct}٪ من السقف`)),
      h('div.grid-2',
        h('div.stat', h('span.small.muted', 'القيمة الإجمالية للعقد'),
          h('b', { dir: 'ltr' }, n2(cap.contract_total))),
        h('div.stat', h('span.small.muted', 'السقف'),
          h('b', { dir: 'ltr' }, n2(cap.cap_amount))),
        h('div.stat', h('span.small.muted', 'المفروض (ما لم يُسقَط)'),
          h('b', { dir: 'ltr', class: cap.over ? 'bad' : '' }, n2(cap.imposed))),
        h('div.stat', h('span.small.muted', 'ما بقي من السقف'),
          h('b', { dir: 'ltr' }, n2(cap.remaining)))),
      h('div.meter', h('span', { style: { width: `${Math.min(100, capPct)}%` },
        class: cap.over ? 'bad' : (cap.near ? 'warn' : '') })),
      cap.over
        ? h('p.small.bad', 'تجاوز المجموعُ السقفَ المنصوص عليه: يُراجَع مع الهيئة، '
            + 'فما زاد على السقف لا يُفرض بموجب العقد.')
        : (cap.near
            ? h('p.small.warn', 'قارب المجموعُ السقف: يُنظر في كل واقعةٍ قبل تسجيلها.')
            : null)) : null;

    const table = rows.length
      ? h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['التاريخ', 'نوع المخالفة', 'المادة', 'اللغة',
            'الوحدات', 'القيمة', 'المقدار', 'الحالة', '']
            .map(t => h('th', t)))),
          h('tbody', rows.map(r => h('tr',
            h('td', { 'data-label': 'التاريخ' }, fmtDate(r.happened_on)),
            h('td', { 'data-label': 'نوع المخالفة' }, h('b', r.kind_name),
              h('span.sub', r.description),
              r.note ? h('span.sub', r.note) : null),
            h('td', { 'data-label': 'المادة' }, r.title || h('span.muted', '—')),
            h('td', { 'data-label': 'اللغة' }, r.lang_name || h('span.muted', '—')),
            h('td', { 'data-label': 'الوحدات', dir: 'ltr',
              title: r.per_label }, String(Number(r.units))),
            h('td', { 'data-label': 'القيمة', dir: 'ltr' },
              r.base_amount == null ? h('span.muted', '—') : n2(r.base_amount)),
            h('td', { 'data-label': 'المقدار', dir: 'ltr' },
              h('b', { class: r.state === 'waived' ? 'muted' : 'bad' }, n2(r.amount)),
              r.is_manual
                ? h('span.badge.gold', { title: 'مقدارٌ مثبتٌ بغير المحتسَب' }, 'مُثبَت')
                : null),
            h('td', { 'data-label': 'الحالة' },
              h('span.badge', { class: STATE[r.state]?.cls || '',
                title: STATE[r.state]?.hint || '' }, STATE[r.state]?.label || r.state)),
            h('td', h('div.row',
              h('button.btn.xs', { type: 'button',
                onclick: () => stateDialog(r) }, 'الحالة'),
              h('button.btn.xs', { type: 'button',
                onclick: () => itemDialog(r) }, 'تعديل'),
              r.state === 'draft'
                ? h('button.btn.xs.danger', { type: 'button', title: 'حذف الواقعة',
                    onclick: () => removeItem(r) }, '×')
                : null)))))))
      : h('p.muted', 'لا وقائعَ مسجَّلة — ولله الحمد.');

    box.replaceChildren(
      h('div.row.between',
        h('p.small.muted', { style: { margin: 0 } },
          'جدولُ الجزاءات من العقد نفسه. والمنصة تحتسب المقدار ولا تفرضه: '
          + 'الفرضُ للهيئة، وهذا تسجيلٌ لما وقع ليُعرف قبل أن يُسأل عنه.'),
        addBtn),
      capCard,
      table,
      h('details.card', h('summary', 'جدولُ الجزاءات كما نصّ العقد'),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['نوع المخالفة', 'الوصف', 'الجزاء', 'عن كل'].map(t => h('th', t)))),
          h('tbody', kinds.map(k => h('tr',
            h('td', { 'data-label': 'نوع المخالفة' }, k.name),
            h('td', { 'data-label': 'الوصف' }, k.description),
            h('td', { 'data-label': 'الجزاء', dir: 'ltr' },
              k.basis === 'fixed' ? `${n2(k.amount)} ريال` : `${k.rate}%`),
            h('td', { 'data-label': 'عن كل' }, k.per_label)))))),
        h('p.small.muted', 'ولا يتجاوز إجماليُّ الغرامات عشرين في المئة من القيمة '
          + 'الإجمالية للعقد، كما نصّ بندُ إجمالي الغرامات.')),
      rows.length
        ? h('div.row', h('button.btn.sm', { type: 'button',
            onclick: () => exportPenalties(rows, cap) }, '⤓ تصدير إلى Excel'))
        : null);
  }

  const exportPenalties = (rows, cap) => {
    const head = ['التاريخ', 'نوع المخالفة', 'الوصف', 'المادة', 'اللغة', 'الوحدات',
      'عن كل', 'القيمة المحتسَب عليها', 'المقدار', 'مثبتٌ بيد', 'الحالة', 'البيان'];
    const out = [head];
    const f2 = v => Number(v || 0).toFixed(2);
    for (const r of rows) {
      out.push([String(r.happened_on), r.kind_name, r.description, r.title || '',
        r.lang_name || '', String(Number(r.units)), r.per_label,
        r.base_amount == null ? '' : f2(r.base_amount), f2(r.amount),
        r.is_manual ? 'نعم' : 'لا', STATE[r.state]?.label || r.state, r.note || '']);
    }
    const pad = (label, value) => {
      const row = new Array(head.length).fill('');
      row[1] = label; row[8] = value;
      return row;
    };
    if (cap) {
      out.push(pad('مجموع المفروض (ما لم يُسقَط)', f2(cap.imposed)));
      out.push(pad(`سقف العقد ${cap.cap_pct}٪`, f2(cap.cap_amount)));
      out.push(pad('ما بقي من السقف', f2(cap.remaining)));
    }
    try {
      downloadBlob(buildXlsx(out, { sheetName: 'الجزاءات', allText: true }),
        'جزاءات-العقد.xlsx');
    } catch (e) { toast(e.message, 'bad'); }
  };

  await draw();
  return h('div.stack',
    h('div', h('h3', 'جزاءاتُ العقد'),
      h('p.small.muted', 'ما فرضه العقد من غرامةٍ على التأخير والتقصير، '
        + 'بمقاديرها وسقفها — تسجيلًا لما وقع لا فرضًا من المنصة.')),
    box);
}
