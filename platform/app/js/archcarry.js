// ترحيلُ خطب العام من أرشيف الترجمة إلى أرشيف الخطب (ملاحظة ٣٣٧)
//
//   يُعرَض أوّلًا ما في العام من أعمالٍ منجَزة، ويُؤشَّر عليها، ويُبيَّن
//   ما رُحِّل منها قبلُ وما لا يصلح ولماذا. ثم يُنقَل المؤشَّرُ عليه
//   دفعةً واحدة، ويُقال ما جرى بالعدد.
//
//   والنقلُ نسخٌ: أرشيفُ الترجمة يبقى سِجلَّ العمل كما هو.
import { h, fill, dialog, toast, busy, fmtDate, fmtHijri } from './ui.js';
import { db } from './sb.js';
import { MOSQUE } from './store.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARY = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

export async function carryDialog(year, section, { onDone } = {}) {
  if (!section) return toast('أضِفْ قسمًا أولًا ليُرحَّل إليه.', 'warn');

  let rows = [];
  try {
    rows = await db.rpc('arch_carry_preview', { p_year: year, p_section: section.id }) || [];
  } catch (e) { return toast(e.message, 'bad'); }

  if (!rows.length) {
    return dialog({
      title: `ترحيلُ ${ARY(year)}هـ`,
      body: h('div.stack',
        h('p', 'لا أعمالَ منجَزةً في أرشيف الترجمة تقع في هذا العام.'),
        h('p.small.muted', 'يُرحَّل ما له تاريخُ خطبةٍ داخلَ العام، وقد أُنجزت '
          + 'ترجمتُه ولم يُحذَف.')),
      buttons: [{ label: 'حسنًا', value: null }]
    });
  }

  const why = r => (!r.sermon_date ? 'بلا تاريخ'
    : !r.mosque ? 'بلا مسجد'
    : !String(r.title || '').trim() ? 'بلا عنوان' : null);

  const boxes = new Map();
  const table = h('table.imp-tbl');
  const overwrite = h('input', { type: 'checkbox', 'aria-label': 'استبدالُ النصوص القائمة' });
  const sum = h('p.small.muted');

  const refreshSum = () => {
    const on = rows.filter(r => boxes.get(r.material_id)?.checked);
    sum.textContent = `المؤشَّرُ عليه: ${AR(on.length)} خطبة`
      + ` · نسخُها: ${AR(on.reduce((a, r) => a + Number(r.langs || 0), 0))}`;
  };

  const draw = () => {
    const body = h('tbody', rows.map((r, i) => {
      const bad = why(r);
      const done = Number(r.carried || 0) >= Number(r.langs || 0) && Number(r.langs || 0) > 0;
      const cb = h('input', { type: 'checkbox', 'aria-label': 'رحِّلْ هذا',
        checked: (!bad && !done) ? true : null, disabled: bad ? true : null });
      cb.onchange = refreshSum;
      boxes.set(r.material_id, cb);
      return h('tr', { class: bad ? 'bad-row' : (done ? 'warn-row' : '') },
        h('td.num', ARY(i + 1)),
        h('td', cb),
        h('td', h('b', r.title || '—'),
          h('div.small.muted', [r.khateeb, MOSQUE[r.mosque] || 'بلا مسجد'].filter(Boolean).join('، '))),
        h('td.num', r.sermon_date
          ? h('span', fmtHijri(r.sermon_date), h('div.small.muted', fmtDate(r.sermon_date)))
          : '—'),
        h('td.num', r.week_no ? `الأسبوع ${AR(r.week_no)}` : '—'),
        h('td.num', AR(r.langs)),
        h('td.num', bad ? h('span.badge.bad', bad)
          : done ? h('span.badge.warn', 'رُحِّلت')
          : r.matched ? h('span.badge', 'تُضَمُّ لقائمة')
          : h('span.badge.ok', 'جديدة')));
    }));
    fill(table,
      h('thead', h('tr',
        h('th', 'م'), h('th', '✓'), h('th', 'الخطبة'), h('th', 'التاريخ'),
        h('th', 'الأسبوع'), h('th', 'اللغات'), h('th', 'الحال'))),
      body);
    refreshSum();
  };
  draw();

  const all = on => { for (const [id, cb] of boxes) { if (!cb.disabled) cb.checked = on; void id; } refreshSum(); };

  const res = await dialog({
    title: `ترحيلُ خطب ${ARY(year)}هـ من أرشيف الترجمة`,
    body: h('div.stack.imp-wrap',
      h('p.small.muted', `تُنقَل الأعمالُ المنجَزةُ إلى قسم «${section.name}»: `
        + 'كلُّ خطبةٍ إلى جمعتها، ونصُّ كلِّ لغةٍ نسخةً لها، والعربيُّ أصلًا. '
        + 'وأرشيفُ الترجمة يبقى على حاله — النقلُ نسخٌ لا حذف.'),
      h('div.row.gap.wrap',
        h('button.btn.xs', { type: 'button', onclick: () => all(true) }, 'أشِّرْ على الكلّ'),
        h('button.btn.xs.ghost', { type: 'button', onclick: () => all(false) }, 'انزعِ التأشير'),
        h('label.check', overwrite, h('span', 'استبدِلْ نصًّا قائمًا في الأرشيف'))),
      sum,
      h('div.scroll-x', table)),
    buttons: [
      { label: 'رحِّلْها', kind: 'primary',
        validate: () => ([...boxes.values()].some(c => c.checked && !c.disabled)
          ? true : 'أشِّرْ على خطبةٍ واحدةٍ على الأقل'),
        value: () => ({
          ids: rows.filter(r => boxes.get(r.material_id)?.checked
            && !boxes.get(r.material_id)?.disabled).map(r => r.material_id),
          overwrite: overwrite.checked
        }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return;

  let out = null;
  try {
    out = await db.rpc('carry_year_to_archive', {
      p_year: year, p_section: section.id,
      p_materials: res.ids, p_overwrite: res.overwrite });
  } catch (e) { return toast(e.message, 'bad'); }

  const o = out || {};
  toast(`رُحِّلت: ${AR(o.created || 0)} جديدة، ${AR(o.merged || 0)} مضمومة، `
    + `${AR(o.versions || 0)} نسخة`
    + (Number(o.skipped) ? ` · ${AR(o.skipped)} مُتعذِّرة` : ''), 'ok');
  if (onDone) await onDone();
}

export const carryButton = (year, getSection, onDone) => {
  const b = h('button.btn.sm', { type: 'button', title: 'نقلُ أعمال العام المنجَزة إلى الأرشيف' },
    '⇄ رحِّلْ من أرشيف الترجمة');
  b.onclick = () => busy(b, () => carryDialog(year, getSection(), { onDone }));
  return b;
};
