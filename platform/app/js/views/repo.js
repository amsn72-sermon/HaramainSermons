// مستودع الترجمة: أعمالُ السنوات الماضية — خطبٌ ودروسٌ وكتب (ملاحظة ٢١٨).
//   وهو خارج حساب العقد: لا يدخل في المستخلص ولا التقرير الشهري ولا
//   الأجور ولا إحصاءات الإنتاج. وإنما هو ذاكرةُ المشروع: يُبحَث فيه
//   ويُصدَّر منه، ولكل نسخةٍ رقمُ توثيقها بالقاعدة المعتمدة.
import { h, toast, busy, dialog, emptyState, fmtDate, fmtHijri, confirm } from '../ui.js';
import { db } from '../sb.js';
import { state, MATERIAL_TYPES, SERMON_TYPES, MOSQUE, langName, isAdmin, can } from '../store.js';

const needsSermonType = t => t === 'خطب';
const yearOf = r => (r.work_date ? Number(String(r.work_date).slice(0, 4)) : null);

export async function render(ctx) {
  const mayEdit = isAdmin() && can('materials');
  let rows = [];
  try {
    rows = await db.select('repo_rows', { select: '*', order: 'work_date.desc' });
  } catch (err) {
    return h('div', h('div.page-head', h('div.grow', h('div.eyebrow', 'الأرشيف'),
      h('h1', 'مستودع الترجمة'))), h('div.card', h('p.small.warn', err.message)));
  }

  const khateebs = (state.khateebs || []).slice();

  // ---------------- التصفية ----------------
  const q = h('input', { type: 'search', placeholder: 'ابحث بالعنوان', 'aria-label': 'بحث' });
  const typeSel = h('select', { 'aria-label': 'نوع العمل' },
    h('option', { value: '' }, 'كل الأنواع'),
    MATERIAL_TYPES.map(t => h('option', { value: t }, t)));
  const mosqueSel = h('select', { 'aria-label': 'المسجد' },
    h('option', { value: '' }, 'الحرمان'),
    Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v)));
  const yearSel = h('select', { 'aria-label': 'السنة' }, h('option', { value: '' }, 'كل السنوات'));
  const langSel = h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'));

  const fillFilters = () => {
    const years = [...new Set(rows.map(yearOf).filter(Boolean))].sort((a, b) => b - a);
    yearSel.replaceChildren(h('option', { value: '' }, 'كل السنوات'),
      ...years.map(y => h('option', { value: String(y) }, String(y))));
    const langs = [...new Set(rows.flatMap(r => (r.languages || '').split(',')).filter(Boolean))].sort();
    langSel.replaceChildren(h('option', { value: '' }, 'كل اللغات'),
      ...langs.map(c => h('option', { value: c }, langName(c) || c)));
  };

  const table = h('div.stack');

  // ---------------- نافذةُ العمل ----------------
  async function workDialog(row = null) {
    const f = {
      title: h('input', { value: row?.title || '', 'aria-label': 'عنوان العمل' }),
      type: h('select', { 'aria-label': 'نوع العمل' },
        MATERIAL_TYPES.map(t => h('option', { value: t, selected: row?.material_type === t }, t))),
      sermon: h('select', { 'aria-label': 'نوع الخطبة' },
        h('option', { value: '' }, '— غير محدد —'),
        SERMON_TYPES.map(t => h('option', { value: t, selected: row?.sermon_type === t }, t))),
      mosque: h('select', { 'aria-label': 'المسجد' },
        h('option', { value: '' }, '— لا يخصّ حرمًا —'),
        Object.entries(MOSQUE).map(([k, v]) =>
          h('option', { value: k, selected: row?.mosque === k }, v))),
      date: h('input', { type: 'date', value: row?.work_date || '', 'aria-label': 'تاريخ العمل' }),
      khateeb: h('select', { 'aria-label': 'الخطيب' }, h('option', { value: '' }, '— غير محدد —')),
      notes: h('textarea', { rows: 2, 'aria-label': 'ملاحظة' }, row?.notes || '')
    };
    const hijriNote = h('p.small.muted');
    const syncHijri = () => {
      hijriNote.textContent = f.date.value ? `بالهجري: ${fmtHijri(f.date.value)}` : '';
    };
    f.date.oninput = syncHijri; syncHijri();

    const syncSermon = () => {
      f.sermon.disabled = !needsSermonType(f.type.value);
      if (f.sermon.disabled) f.sermon.value = '';
    };
    f.type.onchange = () => { syncSermon(); fillKhateebs(); };
    f.mosque.onchange = () => fillKhateebs();

    function fillKhateebs() {
      const list = khateebs.filter(k => !f.mosque.value || k.mosque === f.mosque.value);
      f.khateeb.replaceChildren(h('option', { value: '' }, '— غير محدد —'),
        ...list.map(k => h('option', { value: String(k.id), selected: String(row?.khateeb_id) === String(k.id) },
          k.name)));
    }
    syncSermon(); fillKhateebs();

    // النسخ: الأصلُ العربي وترجماتُه — نصًّا أو رابطًا
    const items = h('div.stack');
    const drafts = [];
    const drawItems = () => {
      items.replaceChildren(...drafts.map((d, i) => h('div.card.stack.repo-item',
        h('div.grid-2',
          h('label.field', 'اللغة', d.lang),
          h('label.field', 'رابط الصوت أو الفيديو', d.url)),
        h('label.field', 'النصّ (يُترك فارغًا إن كان العمل صوتيًّا)', d.body),
        h('div.row',
          h('label.check', d.src, h('span', 'هذه النسخة هي الأصل')),
          h('button.btn.sm.ghost', { type: 'button',
            onclick: () => { drafts.splice(i, 1); drawItems(); } }, 'احذف النسخة')))));
    };
    const addItem = (pre = {}) => {
      const lang = h('select', { 'aria-label': 'لغة النسخة' },
        h('option', { value: 'ar', selected: (pre.language_code || 'ar') === 'ar' }, 'العربية (الأصل)'),
        (state.languages || []).filter(l => l.is_active).map(l =>
          h('option', { value: l.code, selected: pre.language_code === l.code }, l.name)));
      const url = h('input', { type: 'url', value: pre.media_url || '', placeholder: 'https://…',
        'aria-label': 'رابط الوسائط' });
      const body = h('textarea', { rows: 3, 'aria-label': 'نصّ النسخة' }, pre.body_html || '');
      const src = h('input', { type: 'checkbox', checked: pre.is_source ? true : null,
        'aria-label': 'الأصل' });
      drafts.push({ lang, url, body, src });
      drawItems();
    };
    if (!row) addItem({ language_code: 'ar', is_source: true });
    else {
      const have = await db.select('repo_items', { select: '*', work_id: `eq.${row.id}` }).catch(() => []);
      have.forEach(it => addItem(it));
      if (!have.length) addItem({ language_code: 'ar', is_source: true });
    }

    const addBtn = h('button.btn.sm', { type: 'button', onclick: () => addItem({}) }, '＋ أضف لغة');

    const res = await dialog({
      title: row ? 'تعديل عمل في المستودع' : 'إضافة عمل إلى المستودع',
      body: h('div.stack',
        h('p.small.muted', 'ما يُضاف هنا من أعمال السنوات الماضية: لا يدخل في المستخلص '
          + 'ولا التقرير الشهري ولا الأجور، وإنما يُحفظ ويُبحَث فيه ويُصدَّر منه.'),
        h('label.field', 'عنوان العمل', f.title),
        h('div.grid-2',
          h('label.field', 'نوع العمل', f.type),
          h('label.field', 'نوع الخطبة', f.sermon),
          h('label.field', 'المسجد', f.mosque),
          h('label.field', 'الخطيب', f.khateeb)),
        h('label.field', 'تاريخ العمل', f.date, hijriNote),
        h('label.field', 'ملاحظة', f.notes),
        h('fieldset.stack', h('legend', 'النسخ واللغات'), items, h('div.row', addBtn))),
      buttons: [
        { label: 'حفظ', kind: 'primary',
          validate: () => (f.title.value.trim().length >= 2 ? true : 'اكتب عنوان العمل'),
          value: () => ({
            id: row?.id || null,
            title: f.title.value.trim(),
            material_type: f.type.value,
            sermon_type: f.sermon.value || null,
            mosque: f.mosque.value || null,
            work_date: f.date.value || null,
            khateeb_id: f.khateeb.value || null,
            notes: f.notes.value.trim() || null,
            items: drafts.map(d => ({
              language_code: d.lang.value,
              is_source: d.src.checked,
              media_url: d.url.value.trim() || null,
              body_html: d.body.value.trim() || null,
              words: d.body.value.trim() ? d.body.value.trim().split(/\s+/).length : null
            })).filter(x => x.language_code)
          }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('save_repo_work', { p: res });
      toast(row ? 'حُفظ التعديل.' : 'أُضيف العمل إلى المستودع.', 'ok');
      rows = await db.select('repo_rows', { select: '*', order: 'work_date.desc' });
      fillFilters(); draw();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function removeWork(r) {
    if (!await confirm('حذف من المستودع',
      `يُحذف «${r.title}» ونسخُه كلُّها. والحذفُ لا يُستدرك.`, 'احذف', 'danger')) return;
    try {
      await db.rpc('delete_repo_work', { p_id: r.id });
      toast('حُذف العمل.', 'ok');
      rows = rows.filter(x => x.id !== r.id);
      fillFilters(); draw();
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ---------------- الكشف ----------------
  function draw() {
    const term = q.value.trim();
    const list = rows
      .filter(r => !typeSel.value || r.material_type === typeSel.value)
      .filter(r => !mosqueSel.value || r.mosque === mosqueSel.value)
      .filter(r => !yearSel.value || String(yearOf(r)) === yearSel.value)
      .filter(r => !langSel.value || (r.languages || '').split(',').includes(langSel.value))
      .filter(r => !term || (r.title || '').includes(term));

    table.replaceChildren(
      h('p.small.muted', `${list.length} عملًا من ${rows.length}`),
      list.length ? h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['العنوان', 'النوع', 'المسجد', 'التاريخ', 'اللغات', ''].map(t => h('th', t)))),
        h('tbody', list.map(r => h('tr',
          h('td', { 'data-label': 'العنوان' }, h('b', r.title),
            r.khateeb_name ? h('span.sub', r.khateeb_name) : null),
          h('td', { 'data-label': 'النوع' }, r.sermon_type || r.material_type),
          h('td', { 'data-label': 'المسجد' }, MOSQUE[r.mosque] || '—'),
          h('td', { 'data-label': 'التاريخ' },
            r.work_date ? h('span', fmtHijri(r.work_date), h('span.sub', fmtDate(r.work_date))) : '—'),
          h('td', { 'data-label': 'اللغات' },
            (r.languages || '').split(',').filter(Boolean).map(c => langName(c) || c).join('، ') || '—'),
          h('td', mayEdit ? h('div.row',
            h('button.btn.sm', { type: 'button', onclick: () => workDialog(r) }, 'تعديل'),
            h('button.btn.sm.ghost', { type: 'button', onclick: () => removeWork(r) }, 'حذف')) : null))))))
        : emptyState('لا أعمال في المستودع',
            mayEdit ? 'ابدأ بإضافة عمل، أو استورد دفعةً من أعمال السنوات الماضية.'
                    : 'لم يُضَف إلى المستودع شيءٌ بعد.'));
  }

  fillFilters();
  [q, typeSel, mosqueSel, yearSel, langSel].forEach(el => el.addEventListener('input', draw));
  draw();

  return h('div',
    h('div.page-head',
      mayEdit ? h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
        h('button.btn.sm.primary', { type: 'button', onclick: () => workDialog(null) }, '＋ أضف عملًا')) : null,
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'مستودع الترجمة'),
        h('p.muted', 'أعمالُ السنوات الماضية من خطبٍ ودروسٍ وكتب. '
          + 'وهي خارج حساب العقد: تُحفظ ويُبحَث فيها ويُصدَّر منها، ولا تدخل في المستخلص ولا الأجور.'))),
    h('section.card.stack',
      h('div.filters', q, typeSel, mosqueSel, yearSel, langSel)),
    table);
}
