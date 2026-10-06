// مستودع الترجمة: أعمالُ السنوات الماضية — خطبٌ ودروسٌ وكتب (ملاحظة ٢١٨).
//   وهو خارج حساب العقد: لا يدخل في المستخلص ولا التقرير الشهري ولا
//   الأجور ولا إحصاءات الإنتاج. وإنما هو ذاكرةُ المشروع: يُبحَث فيه
//   ويُصدَّر منه، ولكل نسخةٍ رقمُ توثيقها بالقاعدة المعتمدة.
import { h, toast, busy, dialog, emptyState, fmtDate, fmtHijri, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, MATERIAL_TYPES, SERMON_TYPES, MOSQUE, langName, isAdmin, can } from '../store.js';
import { typeIcon } from '../icons.js';
import { pickColumns, narrowSheet } from '../columns.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';
import { fileName } from '../page.js';

const needsSermonType = t => t === 'خطب';
const yearOf = r => (r.work_date ? Number(String(r.work_date).slice(0, 4)) : null);

// رفعُ ملفٍ إلى حاوية المستودع باسمٍ لا يتصادم
async function putFile(f) {
  const safe = String(f.name).replace(/[^\w.\-]+/g, '_');
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safe}`;
  await storage.upload('repo', path, f);
  return path;
}

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
        h('label.field', 'ملفُّ النسخة (PDF أو وورد)', d.file, d.fileNote),
        h('label.field', 'النصّ (يُترك فارغًا إن كان العمل ملفًّا أو صوتيًّا)', d.body),
        h('div.row',
          h('label.check', d.src, h('span', 'هذه النسخة هي الأصل')),
          h('button.btn.sm.ghost', { type: 'button',
            onclick: () => { drafts.splice(i, 1); drawItems(); } }, 'احذف النسخة')))));
    };
    const addItem = (pre = {}) => {
      const lang = h('select', { 'aria-label': 'لغة النسخة' },
        h('option', { value: 'ar', selected: (pre.language_code || 'ar') === 'ar' }, 'العربية (الأصل)'),
        (state.languages || []).filter(l => l.is_active).map(l =>
          h('option', { value: l.code, selected: pre.language_code === l.code }, l.name_ar)));
      const url = h('input', { type: 'url', value: pre.media_url || '', placeholder: 'https://…',
        'aria-label': 'رابط الوسائط' });
      const body = h('textarea', { rows: 3, 'aria-label': 'نصّ النسخة' }, pre.body_html || '');
      const src = h('input', { type: 'checkbox', checked: pre.is_source ? true : null,
        'aria-label': 'الأصل' });
      // رفعٌ فرديٌّ بملفٍ وبيانات (ملاحظة ٢٢٦)
      const file = h('input', { type: 'file', accept: '.pdf,.doc,.docx', 'aria-label': 'ملف النسخة' });
      const fileNote = h('small.muted', pre.file_path ? 'مرفوعٌ من قبل — واختيارُ ملفٍ يستبدله' : '');
      const d = { lang, url, body, src, file, fileNote, path: pre.file_path || null };
      file.onchange = () => busy(file, async () => {
        if (!file.files[0]) return;
        try { d.path = await putFile(file.files[0]); fileNote.textContent = 'رُفع الملف.'; }
        catch (e) { fileNote.textContent = e.message; }
      });
      drafts.push(d);
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
              file_path: d.path || null,
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

  // أيقوناتُ السطر: عرضٌ وتعديلٌ وحذف (ملاحظة ٢٨٨)
  const RICONS = {
    open: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M14 6l4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    file: '<path d="M6 2h7l5 5v15H6z"/><path d="M13 2v5h5"/>',
    media: '<path d="M3 6h12v12H3z"/><path d="M15 10l6-3v10l-6-3z"/>'
  };
  const rIcon = name => {
    const sp = document.createElement('span');
    sp.className = 'ico'; sp.setAttribute('aria-hidden', 'true');
    sp.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${RICONS[name]}</svg>`;
    return sp;
  };

  // فتحُ العمل: نسخُه ولغاتُها وملفّاتُها — فالعملُ يُقرأ لا يُعدَّل فقط
  //   (ملاحظة ٢٨٩)
  async function openWork(r) {
    const box = h('div.stack', h('p.muted', 'يُحمَّل…'));
    const dlg = dialog({
      title: r.title || 'عمل',
      body: h('div.stack',
        h('p.small.muted', [r.sermon_type || r.material_type, MOSQUE[r.mosque],
          r.work_date ? `${fmtHijri(r.work_date)} · ${fmtDate(r.work_date)}` : null,
          r.khateeb_name].filter(Boolean).join(' · ')),
        r.notes ? h('p.small', r.notes) : null,
        box),
      buttons: [
        mayEdit ? { label: 'تعديل', value: 'edit' } : null,
        { label: 'إغلاق', value: null }
      ].filter(Boolean)
    });

    try {
      const items = await db.select('repo_items',
        { select: '*', work_id: `eq.${r.id}`, order: 'is_source.desc,language_code.asc' }) || [];
      box.replaceChildren(items.length ? h('div.stack', items.map(it => {
        const openFile = h('button.btn.xs', { type: 'button' }, 'افتح الملف');
        openFile.onclick = () => busy(openFile, async () => {
          try { window.open(await storage.signedUrl('repo', it.file_path, 600), '_blank'); }
          catch (e) { toast(e.message, 'bad'); }
        });
        return h('div.card.stack.repo-view',
          h('div.row.between.wrap',
            h('b', langName(it.language_code) || it.language_code),
            h('div.row', { style: { gap: '6px' } },
              it.is_source ? h('span.badge.gold', 'الأصل') : null,
              it.doc_no ? h('span.badge', it.doc_no) : null)),
          it.body_html
            ? h('div.repo-text', { dir: 'auto' },
                String(it.body_html).replace(/<[^>]*>/g, ' ').slice(0, 1200))
            : null,
          h('div.row', { style: { gap: '6px' } },
            it.file_path ? openFile : null,
            it.media_url
              ? h('a.btn.xs.ghost', { href: it.media_url, target: '_blank', rel: 'noopener' },
                  'الصوت أو الفيديو')
              : null,
            (!it.file_path && !it.media_url && !it.body_html)
              ? h('span.small.muted', 'لا ملفَّ ولا نصَّ في هذه النسخة.') : null));
      })) : h('p.small.muted', 'لم تُسجَّل نسخٌ لهذا العمل بعد — افتح «تعديل» وأضِف نسخةً.'));
    } catch (e) { box.replaceChildren(h('p.small.warn', e.message)); }

    if (await dlg === 'edit') workDialog(r);
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
  // التحديدُ للتصدير المجمَّع (ملاحظة ٢٣٧)
  const picked = new Set();
  const shown = () => {
    const term = q.value.trim();
    return rows
      .filter(r => !typeSel.value || r.material_type === typeSel.value)
      .filter(r => !mosqueSel.value || r.mosque === mosqueSel.value)
      .filter(r => !yearSel.value || String(yearOf(r)) === yearSel.value)
      .filter(r => !langSel.value || (r.languages || '').split(',').includes(langSel.value))
      .filter(r => !term || (r.title || '').includes(term));
  };
  const selected = () => rows.filter(r => picked.has(r.id));

  // بطاقةٌ مستطيلةٌ لكلِّ عمل، والأعمالُ مجموعةٌ بالنوع (ملاحظة ٢٥٣)
  function workCard(r) {
    const cb = h('input', { type: 'checkbox', checked: picked.has(r.id) ? true : null,
      'aria-label': `تحديد ${r.title}` });
    cb.onchange = () => { cb.checked ? picked.add(r.id) : picked.delete(r.id); drawBar(); drawHeads(); };
    const langs = (r.languages || '').split(',').filter(Boolean).map(c => langName(c) || c);
    return h('article.repo-card' + (picked.has(r.id) ? '.on' : ''),
      h('label.repo-pick', cb),
      h('span.repo-ico', typeIcon(r.sermon_type && r.material_type === 'خطب' ? 'خطب' : r.material_type, { size: 22 })),
      h('div.repo-main',
        h('b.repo-title', r.title || '—'),
        h('div.repo-meta',
          h('span', r.sermon_type || r.material_type),
          h('span', MOSQUE[r.mosque] || '—'),
          r.work_date ? h('span', fmtHijri(r.work_date), ' · ', fmtDate(r.work_date)) : null,
          r.khateeb_name ? h('span', r.khateeb_name) : null),
        langs.length ? h('div.repo-langs', langs.map(n => h('span.badge', n)))
          : h('span.small.muted', 'بلا لغاتٍ مسجَّلة')),
      h('div.row.repo-acts', acts(r)));
  }

  // إجراءاتُ العمل أيقوناتٍ: تُعرَض في البطاقة وفي جدول «الجميع» سواء
  const acts = r => [
    h('button.icon-btn', { type: 'button', title: 'عرض العمل', 'aria-label': 'عرض العمل',
      onclick: () => openWork(r) }, rIcon('open')),
    mayEdit ? h('button.icon-btn', { type: 'button', title: 'تعديل', 'aria-label': 'تعديل',
      onclick: () => workDialog(r) }, rIcon('edit')) : null,
    mayEdit ? h('button.icon-btn.danger', { type: 'button', title: 'حذف', 'aria-label': 'حذف',
      onclick: () => removeWork(r) }, rIcon('trash')) : null
  ].filter(Boolean);

  const heads = new Map();          // النوع ← مربّعُ تحديدِ مجموعته
  const drawHeads = () => {
    for (const [type, box] of heads) {
      const g = shown().filter(r => (r.material_type || 'غير ذلك') === type);
      box.checked = g.length > 0 && g.every(r => picked.has(r.id));
    }
  };

  // عرضان: بطاقاتٌ بالأنواع، وجدولُ «الجميع» صفوفُه قصيرةٌ وفيه
  //   أيقوناتُ العرض والتعديل والحذف (ملاحظة ٢٨٨)
  let view = 'cards';
  const viewBar = h('div.row', { style: { gap: '6px' } });
  const drawViewBar = () => {
    const mk = (key, label, title) => {
      const b = h('button.btn.xs' + (view === key ? '.primary' : ''), { type: 'button', title }, label);
      b.onclick = () => { view = key; drawViewBar(); draw(); };
      return b;
    };
    viewBar.replaceChildren(
      mk('cards', '▦ بطاقات', 'بطاقةٌ لكلِّ عمل مجموعةً بالأنواع'),
      mk('all', '▤ الجميع', 'جدولٌ واحدٌ لكلِّ الأعمال'));
  };
  drawViewBar();

  function allTable(list) {
    return h('div.table-wrap', h('table.responsive.repo-all',
      h('thead', h('tr', ['', 'العمل', 'النوع', 'المسجد', 'التاريخ', 'اللغات', '']
        .map(t => h('th', t)))),
      h('tbody', list.map(r => {
        const cb = h('input', { type: 'checkbox', checked: picked.has(r.id) ? true : null,
          'aria-label': `تحديد ${r.title}` });
        cb.onchange = () => { cb.checked ? picked.add(r.id) : picked.delete(r.id); drawBar(); };
        const langs = (r.languages || '').split(',').filter(Boolean);
        return h('tr',
          h('td', cb),
          h('td', { 'data-label': 'العمل' },
            h('span.repo-ico.sm', typeIcon(r.material_type, { size: 16 })),
            h('b', r.title || '—')),
          h('td', { 'data-label': 'النوع' }, h('span.small', r.sermon_type || r.material_type || '—')),
          h('td', { 'data-label': 'المسجد' }, h('span.small', MOSQUE[r.mosque] || '—')),
          h('td', { 'data-label': 'التاريخ' },
            h('span.small', r.work_date ? fmtHijri(r.work_date) : '—')),
          h('td', { 'data-label': 'اللغات' },
            h('span.small', langs.length ? `${langs.length} لغة` : '—')),
          h('td', h('div.row.repo-acts', acts(r))));
      }))));
  }

  function draw() {
    const list = shown();
    const allOn = list.length > 0 && list.every(r => picked.has(r.id));
    const head = h('input', { type: 'checkbox', checked: allOn ? true : null,
      'aria-label': 'حدّد المعروض' });
    head.onchange = () => {
      list.forEach(r => (head.checked ? picked.add(r.id) : picked.delete(r.id)));
      draw(); drawBar();
    };

    // الترتيبُ بالنوع كما في بطاقات الأنواع، ثم ما خرج عنها
    const order = [...MATERIAL_TYPES, 'غير ذلك'];
    const groups = new Map();
    for (const r of list) {
      const t = MATERIAL_TYPES.includes(r.material_type) ? r.material_type : 'غير ذلك';
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(r);
    }
    heads.clear();

    const sections = order.filter(t => groups.has(t)).map(t => {
      const g = groups.get(t);
      const box = h('input', { type: 'checkbox',
        checked: g.every(r => picked.has(r.id)) ? true : null,
        'aria-label': `حدّد ${t}` });
      box.onchange = () => {
        g.forEach(r => (box.checked ? picked.add(r.id) : picked.delete(r.id)));
        draw(); drawBar();
      };
      heads.set(t, box);
      return h('section.repo-group',
        h('div.repo-group-head',
          h('label.repo-pick', box),
          typeIcon(t, { size: 20 }), h('b', t),
          h('span.badge', `${g.length} عملًا`)),
        h('div.repo-cards', g.map(workCard)));
    });

    table.replaceChildren(
      list.length ? h('div.stack',
        h('div.row.between.wrap',
          h('label.check', head, h('span', `حدّد المعروض — ${list.length} عملًا من ${rows.length}`)),
          h('div.row.wrap', { style: { gap: '8px' } },
            h('span.small.muted', `${picked.size} محدَّدًا`), viewBar)),
        ...(view === 'all' ? [allTable(list)] : sections))
        : emptyState('لا أعمال في المستودع',
            mayEdit ? 'ابدأ بإضافة عمل، أو استورد دفعةً من أعمال السنوات الماضية.'
                    : 'لم يُضَف إلى المستودع شيءٌ بعد.'));
  }


  // ---------------- شريطُ التحديد والتصدير المجمَّع (ملاحظة ٢٣٧) ----------------
  const REPO_COLS = [
    { key: 'n', label: 'م' }, { key: 'title', label: 'العنوان' },
    { key: 'type', label: 'نوع العمل' }, { key: 'sub', label: 'النوع الفرعي' },
    { key: 'mosque', label: 'المسجد' }, { key: 'hijri', label: 'التاريخ الهجري' },
    { key: 'greg', label: 'التاريخ الميلادي' }, { key: 'langs', label: 'اللغات' },
    { key: 'docs', label: 'أرقام التوثيق' }, { key: 'khateeb', label: 'الخطيب أو المؤلف' },
    { key: 'notes', label: 'ملاحظة' }
  ];

  const sheetOfRepo = (list, items) => {
    const docsOf = w => items.filter(i => i.work_id === w.id)
      .map(i => i.doc_no).filter(Boolean).join(' · ');
    return [REPO_COLS.map(c => c.label),
      ...list.map((r, i) => [
        String(i + 1), r.title || '—', r.material_type || '—', r.sermon_type || '—',
        MOSQUE[r.mosque] || '—',
        r.work_date ? fmtHijri(r.work_date) : '—',
        r.work_date ? fmtDate(r.work_date) : '—',
        (r.languages || '').split(',').filter(Boolean).map(c => langName(c) || c).join('، ') || '—',
        docsOf(r) || '—', r.khateeb_name || '—', r.notes || ''
      ])];
  };

  const itemsOf = async (list) => {
    if (!list.length) return [];
    try {
      return await db.select('repo_items',
        { select: '*', work_id: `in.(${list.map(r => r.id).join(',')})` });
    } catch { return []; }
  };

  // ١) كشفٌ — Excel وWord وPDF على الكليشة
  async function exportList(list) {
    const items = await itemsOf(list);
    const keys = await pickColumns({ key: 'repo', title: 'أعمدة كشف المستودع',
      columns: REPO_COLS, required: ['title'] });
    if (!keys) return;
    const sheet = narrowSheet(sheetOfRepo(list, items), REPO_COLS, keys);
    const title = `مستودع الترجمة — ${list.length} عملًا`;
    const note = `أُصدر في ${fmtDate(new Date())} — المستودعُ خارج حساب العقد`;
    const fmt = await fmtAsk();
    if (!fmt) return;
    try {
      if (fmt === 'xlsx') downloadBlob(buildXlsx(sheet, { sheetName: 'المستودع', allText: true }), `${title}.xlsx`);
      else {
        const { exportWord, exportPdf } = await import('../teamexport.js');
        if (fmt === 'docx') await exportWord(sheet, title, { note });
        else if (!exportPdf(sheet, title, { note })) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function fmtAsk() {
    const sel = h('select', { 'aria-label': 'الصيغة' },
      h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
      h('option', { value: 'docx' }, 'Word على كليشة الهيئة'),
      h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
    return dialog({ title: 'صيغة الكشف',
      body: h('label.field', 'الصيغة', sel),
      buttons: [{ label: 'تابع', kind: 'primary', value: () => sel.value },
        { label: 'إلغاء', value: null }] });
  }

  // ٢) كتابٌ مجمَّع — كأرشيف الترجمة، ولا يدخله إلا ما له نص
  async function exportBook(list) {
    const items = await itemsOf(list);
    const withText = items.filter(i => String(i.body_html || '').trim());
    const codes = [...new Set(withText.map(i => i.language_code))].sort();
    if (!codes.length) {
      return toast('لا نصوصَ في المحدَّد — وإنما ملفاتٌ مرفوعة. استعمل «حزمة الملفات».', 'bad');
    }
    const onlyFiles = list.length - new Set(withText.map(i => i.work_id)).size;

    const titleIn = h('input', { value: 'من مستودع الترجمة', 'aria-label': 'عنوان الكتاب' });
    const boxes = codes.map(c => h('label.check',
      h('input', { type: 'checkbox', value: c, checked: true, 'aria-label': langName(c) || c }),
      h('span', langName(c) || c)));
    const withAr = h('input', { type: 'checkbox', checked: true, 'aria-label': 'ضمّ الأصل العربي' });

    const res = await dialog({
      title: 'كتابٌ مجمَّع من المستودع',
      body: h('div.stack',
        h('p.small.muted', `من ${list.length} عملًا محدَّدًا: `
          + `${new Set(withText.map(i => i.work_id)).size} له نصٌّ يدخل الكتاب`
          + (onlyFiles ? `، و${onlyFiles} ملفاتٌ تدخل الحزمة لا الكتاب.` : '.')),
        h('label.field', 'عنوان الكتاب', titleIn),
        h('fieldset.stack', h('legend', 'اللغات'), h('div.row.wrap', boxes)),
        h('label.check', withAr, h('span', 'اضمم الأصل العربي قبل تراجم كل عمل'))),
      buttons: [
        { label: 'ابنِ الكتاب', kind: 'primary',
          validate: () => (boxes.some(b => b.querySelector('input').checked)
            ? true : 'اختر لغةً واحدة على الأقل'),
          value: () => ({ title: titleIn.value.trim() || 'من مستودع الترجمة',
            codes: boxes.map(b => b.querySelector('input'))
              .filter(i => i.checked).map(i => i.value),
            arabic: withAr.checked }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;

    const { printBook, sortBook } = await import('../bookexport.js');
    const byWork = new Map(list.map(w => [w.id, w]));
    let opened = 0;
    for (const code of res.codes) {
      const picks = [];
      for (const it of withText.filter(i => i.language_code === code)) {
        const w = byWork.get(it.work_id); if (!w) continue;
        if (res.arabic) {
          const src = withText.find(x => x.work_id === w.id && x.language_code === 'ar');
          if (src && src.id !== it.id) picks.push(shapeBook(w, src));
        }
        picks.push(shapeBook(w, it));
      }
      if (!picks.length) continue;
      if (printBook(sortBook(picks),
        { title: res.title, period: 'المستودع', language: code, edition: '' },
        { autoPrint: false })) opened++;
      await new Promise(r => setTimeout(r, 400));
    }
    if (!opened) toast('اسمح بالنوافذ المنبثقة لبناء الكتاب.', 'bad');
    else toast(opened === 1 ? 'فُتح الكتاب.' : `فُتحت ${opened} كتب — كلٌّ بلغته.`, 'ok');
  }

  // شكلُ العمل كما يفهمه بانيا الكتاب
  const shapeBook = (w, it) => ({
    material: { title: w.title, material_type: w.material_type, sermon_type: w.sermon_type,
      mosque: w.mosque, sermon_date: w.work_date, author: w.khateeb_name,
      khateeb: w.khateeb_name ? { name: w.khateeb_name } : null },
    khateeb: w.khateeb_name || null,
    track: { translation_html: it.body_html, doc_no: it.doc_no,
      doc_no_at: w.work_date, completed_at: w.work_date,
      language_code: it.language_code, is_source: !!it.is_source }
  });

  // ٣) حزمةُ ملفات — الأصولُ المرفوعة بأرقام توثيقها، ومعها كشفُ المحتوى
  async function exportFiles(list) {
    const items = (await itemsOf(list)).filter(i => i.file_path);
    if (!items.length) return toast('لا ملفاتٍ مرفوعةً في المحدَّد.', 'bad');
    const byWork = new Map(list.map(w => [w.id, w]));
    const safe = v => String(v || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

    const prog = h('p.small.muted', `جارٍ جمع ${items.length} ملفًّا…`);
    table.prepend(h('div.card', prog));
    const files = [];
    const index = [['م', 'رقم التوثيق', 'العنوان', 'اللغة', 'اسم الملف']];
    let n = 0;
    for (const it of items) {
      const w = byWork.get(it.work_id); if (!w) continue;
      prog.textContent = `جارٍ جمع الملفات… ${++n} من ${items.length}`;
      const name = `${safe(it.doc_no || w.title)} — ${safe(w.title)} — ${safe(langName(it.language_code) || it.language_code)}`
        + (it.file_path.match(/\.[a-z0-9]+$/i) ? it.file_path.match(/\.[a-z0-9]+$/i)[0] : '');
      index.push([String(n), it.doc_no || '—', w.title, langName(it.language_code) || it.language_code, name]);
      try {
        const url = await storage.signedUrl('repo', it.file_path, 600);
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        files.push([name, buf]);
      } catch { /* يُتخطّى ما تعذّر */ }
    }
    prog.parentElement?.remove();
    if (!files.length) return toast('تعذّر جمعُ الملفات.', 'bad');
    files.push(['كشف المحتوى.csv',
      '\uFEFF' + index.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')]);
    try {
      const { zipFiles } = await import('../xlsx.js');
      downloadBlob(zipFiles(files), `مستودع الترجمة — ${files.length - 1} ملفًّا.zip`);
      toast(`حُزمت ${files.length - 1} ملفًّا.`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  // زرُّ تصديرٍ ظاهرٌ دائمًا: فميزةٌ لا تُرى إلا بعد فعلٍ لا يعرفه
  // المستخدمُ ميزةٌ مفقودة (ملاحظة ٢٥١)
  async function exportAsk() {
    const list = shown();
    const sel = selected();
    const scope = h('select', { 'aria-label': 'ما يُصدَّر' },
      sel.length ? h('option', { value: 'picked' }, `المحدَّد — ${sel.length} عملًا`) : null,
      h('option', { value: 'shown' }, `المعروض بعد التصفية — ${list.length} عملًا`),
      h('option', { value: 'all' }, `كلُّ المستودع — ${rows.length} عملًا`));
    const kind = h('select', { 'aria-label': 'شكل التصدير' },
      h('option', { value: 'list' }, 'كشف — Excel أو Word أو PDF'),
      h('option', { value: 'book' }, 'كتابٌ مجمَّع — النصوص في مستندٍ واحد'),
      h('option', { value: 'files' }, 'حزمةُ ملفات — الأصول المرفوعة'));
    const res = await dialog({
      title: 'تصدير من المستودع',
      body: h('div.stack',
        h('p.small.muted', 'اختر ما يُصدَّر وشكلَه. والتحديدُ من مربّعات الجدول يُقدَّم على غيره.'),
        h('div.grid-2', h('label.field', 'ما يُصدَّر', scope), h('label.field', 'الشكل', kind))),
      buttons: [{ label: 'تابِع', kind: 'primary', value: () => ({ scope: scope.value, kind: kind.value }) },
        { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    const what = res.scope === 'picked' ? sel : (res.scope === 'shown' ? list : rows);
    if (!what.length) return toast('لا أعمال في هذا النطاق.', 'bad');
    if (res.kind === 'list') return exportList(what);
    if (res.kind === 'book') return exportBook(what);
    return exportFiles(what);
  }

  const bar = h('div.pick-bar', { hidden: true });
  const drawBar = () => {
    const n = picked.size;
    bar.hidden = n === 0;
    if (!n) return;
    const list = selected();
    bar.replaceChildren(
      h('b', `${n} عملًا محدَّدًا`),
      h('div.row.wrap',
        h('button.btn.sm', { type: 'button', onclick: () => exportList(list) }, 'كشف'),
        h('button.btn.sm', { type: 'button', onclick: () => exportBook(list) }, '📕 كتابٌ مجمَّع'),
        h('button.btn.sm', { type: 'button', onclick: () => exportFiles(list) }, '⤓ حزمةُ ملفات'),
        h('button.btn.sm.ghost', { type: 'button',
          onclick: () => { picked.clear(); draw(); drawBar(); } }, 'ألغِ التحديد')));
  };

  // ---------------- أيقوناتُ الأنواع (ملاحظة ٢٢٦) ----------------
  const tiles = h('div.repo-types');
  const drawTiles = (counts) => {
    const byType = new Map((counts || []).map(c => [c.material_type, c]));
    const mk = (label, value, iconEl, n) => {
      const b = h('button.repo-tile' + (typeSel.value === value ? '.on' : ''), { type: 'button' },
        iconEl, h('b', label), h('span.sub', `${n} عملًا`));
      b.onclick = () => { typeSel.value = value; drawTiles(counts); draw(); };
      return b;
    };
    tiles.replaceChildren(
      ...MATERIAL_TYPES.map(t => mk(t, t, typeIcon(t), byType.get(t)?.works || 0)),
      mk('الجميع', '', typeIcon('__all'), rows.length));
  };

  fillFilters();
  [q, typeSel, mosqueSel, yearSel, langSel].forEach(el => el.addEventListener('input', draw));
  draw();
  db.rpc('repo_type_counts').then(drawTiles).catch(() => drawTiles([]));

  // ---------------- الرفعُ الجماعي (ملاحظة ٢٢٦) ----------------
  async function bulkUpload() {
    const files = h('input', { type: 'file', multiple: true, accept: '.pdf,.doc,.docx',
      'aria-label': 'الملفات' });
    const label = h('input', { value: `دفعة ${fmtDate(new Date().toISOString().slice(0, 10))}`,
      'aria-label': 'اسم الدفعة' });
    const pick = await dialog({
      title: 'رفعٌ جماعيٌّ إلى المستودع',
      body: h('div.stack',
        h('p.small.muted', 'اختر ملفاتِ الدفعة — PDF أو وورد. تُرفع أولًا، ثم تُقرأ أسماؤها '
          + 'فيُستنبط منها النوعُ واللغةُ والتاريخُ والمسجدُ والعنوان، ثم يُعرض ذلك جدولَ '
          + 'مراجعةٍ تصحّح فيه ما أخطأ الاستنباط. ولا يُكتب في المستودع شيءٌ حتى تعتمد.'),
        h('label.field', 'اسم الدفعة', label),
        h('label.field', 'الملفات', files)),
      buttons: [
        { label: 'ارفع', kind: 'primary',
          validate: () => (files.files?.length ? true : 'اختر ملفًا واحدًا على الأقل'),
          value: () => ({ list: [...files.files], label: label.value.trim() || 'دفعة' }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!pick) return;

    const prog = h('p.small.muted', 'جارٍ الرفع…');
    const holder = h('div.card.stack', h('h3', 'رفعُ الدفعة'), prog);
    table.prepend(holder);
    let batchId = null;
    try {
      const b = await db.insert('repo_batches', { label: pick.label });
      batchId = (Array.isArray(b) ? b[0] : b)?.id || null;
    } catch { batchId = null; }

    let n = 0;
    for (const f of pick.list) {
      prog.textContent = `جارٍ الرفع… ${++n} من ${pick.list.length}`;
      try {
        const path = await putFile(f);
        await db.rpc('stage_repo_upload', { p: { batch_id: batchId, file_name: f.name,
          file_path: path, size_bytes: f.size } });
      } catch (e) { toast(`${f.name}: ${e.message}`, 'bad'); }
    }
    holder.remove();
    await reviewBatch(batchId);
  }

  // جدولُ المراجعة قبل الاعتماد
  async function reviewBatch(batchId) {
    let pend = [];
    try {
      pend = await db.select('repo_uploads', { select: '*', status: 'eq.pending',
        ...(batchId ? { batch_id: `eq.${batchId}` } : {}), order: 'file_name.asc' });
    } catch (e) { toast(e.message, 'bad'); return; }
    if (!pend.length) { toast('لا ملفاتٍ تنتظر المراجعة.', 'ok'); return; }

    // التسميةُ الموحَّدة: المنصةُ تقرأ الملفَّ فتسمّيه كما يُسمّى في
    //   أرشيف الترجمة، ونمطُ التسمية هو المضبوط في الإعدادات (ملاحظة ٢٩٠)
    const stdOf = u => {
      const kh = (state.khateebs || []).find(k => String(k.id) === String(u.khateeb_id));
      return fileName({
        title: u.title || '', material_type: u.material_type || 'خطب',
        sermon_type: u.sermon_type || null, mosque: u.mosque || null,
        sermon_date: u.work_date || null
      }, u.language_code || null, kh?.name || '');
    };

    const rowsEl = pend.map(u => {
      const std = stdOf(u);
      const title = h('input', { value: std || u.title || '', 'aria-label': 'العنوان' });
      const stdBtn = h('button.btn.xs.ghost', { type: 'button', title: 'التسميةُ الموحَّدة' }, 'وحِّد');
      stdBtn.onclick = () => { title.value = stdOf({ ...u, title: u.title }) || title.value; };
      const rawBtn = h('button.btn.xs.ghost', { type: 'button', title: 'اسمُ الملف كما هو' }, 'كما وَرَد');
      rawBtn.onclick = () => { title.value = u.title || ''; };
      const type = h('select', { 'aria-label': 'النوع' },
        h('option', { value: '' }, '—'),
        MATERIAL_TYPES.map(t => h('option', { value: t, selected: u.material_type === t }, t)));
      const sermon = h('select', { 'aria-label': 'نوع الخطبة' },
        h('option', { value: '' }, '—'),
        SERMON_TYPES.map(t => h('option', { value: t, selected: u.sermon_type === t }, t)));
      const lang = h('select', { 'aria-label': 'اللغة' },
        h('option', { value: '' }, '—'),
        h('option', { value: 'ar', selected: u.language_code === 'ar' }, 'العربية (الأصل)'),
        (state.languages || []).map(l =>
          h('option', { value: l.code, selected: u.language_code === l.code }, l.name_ar)));
      const mosque = h('select', { 'aria-label': 'المسجد' },
        h('option', { value: '' }, '—'),
        Object.entries(MOSQUE).map(([k, v]) =>
          h('option', { value: k, selected: u.mosque === k }, v)));
      const date = h('input', { type: 'date', value: u.work_date || '', 'aria-label': 'التاريخ' });
      const del = h('button.btn.xs.ghost', { type: 'button' }, '✕');
      const tr = h('tr',
        h('td', { 'data-label': 'الملف' }, h('span.small.muted', { dir: 'ltr' }, u.file_name)),
        h('td', { 'data-label': 'العنوان' }, title,
          h('div.row', { style: { gap: '4px' } }, stdBtn, rawBtn)),
        h('td', { 'data-label': 'النوع' }, type, sermon),
        h('td', { 'data-label': 'اللغة' }, lang),
        h('td', { 'data-label': 'المسجد' }, mosque),
        h('td', { 'data-label': 'التاريخ' }, date),
        h('td', del));
      del.onclick = async () => {
        try { await db.rpc('delete_repo_upload', { p_id: u.id }); tr.remove(); }
        catch (e) { toast(e.message, 'bad'); }
      };
      tr._save = () => db.rpc('save_repo_upload', { p: { id: u.id,
        title: title.value.trim() || null, material_type: type.value || null,
        sermon_type: sermon.value || null, language_code: lang.value || null,
        is_source: lang.value === 'ar', mosque: mosque.value || null,
        work_date: date.value || null,
        work_key: `${title.value.trim()}|${date.value || ''}`.toLowerCase() } });
      return tr;
    });

    const res = await dialog({
      title: `مراجعةُ ${pend.length} ملفًّا قبل الاعتماد`,
      body: h('div.stack',
        h('p.small.muted', 'ما اتّفق عنوانُه وتاريخُه اجتمع في عملٍ واحدٍ بلغاته. '
          + 'وما نقصه العنوانُ أو النوعُ أو اللغةُ يُتخطّى ويبقى في الانتظار.'),
        h('p.small.muted', 'والأسماءُ مكتوبةٌ بالصيغة الموحَّدة التي يُسمّى بها أرشيفُ '
          + 'الترجمة — تُعدَّل متى شئت، و«كما وَرَد» يُعيد اسمَ الملف.'),
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['الملف', 'العنوان', 'النوع', 'اللغة', 'المسجد', 'التاريخ', '']
            .map(t => h('th', t)))),
          h('tbody', rowsEl)))),
      buttons: [
        { label: 'اعتمد الدفعة', kind: 'primary', value: () => 'commit' },
        { label: 'احفظ ولا تعتمد', value: () => 'save' },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;

    for (const tr of rowsEl) {
      if (!tr.isConnected) continue;
      try { await tr._save(); } catch (e) { toast(e.message, 'bad'); }
    }
    if (res === 'save') { toast('حُفظت المراجعة، ولم تُعتمد بعد.', 'ok'); return; }

    try {
      const out = await db.rpc('commit_repo_uploads', { p_batch: batchId });
      const d = (Array.isArray(out) ? out[0] : out) || {};
      toast(`اعتُمد: ${d.works || 0} عملًا و${d.items || 0} نسخة`
        + (d.skipped ? `، وتُخطّي ${d.skipped}` : '') + '.', 'ok');
      rows = await db.select('repo_rows', { select: '*', order: 'work_date.desc' });
      fillFilters(); draw();
      db.rpc('repo_type_counts').then(drawTiles).catch(() => {});
    } catch (e) { toast(e.message, 'bad'); }
  }

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        h('button.btn.sm', { type: 'button', onclick: () => exportAsk() }, '⤓ تصدير'),
        mayEdit ? h('button.btn.sm', { type: 'button', onclick: () => bulkUpload() }, '⤒ رفعٌ جماعي') : null,
        mayEdit ? h('button.btn.sm.ghost', { type: 'button', onclick: () => reviewBatch(null) }, 'ما ينتظر المراجعة') : null,
        mayEdit ? h('button.btn.sm.primary', { type: 'button', onclick: () => workDialog(null) }, '＋ أضف عملًا') : null),
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'مستودع الترجمة'),
        h('p.muted', 'أعمالُ السنوات الماضية من خطبٍ ودروسٍ وكتب. '
          + 'وهي خارج حساب العقد: تُحفظ ويُبحَث فيها ويُصدَّر منها، ولا تدخل في المستخلص ولا الأجور.'))),
    tiles,
    bar,
    h('section.card.stack',
      h('div.filters', q, typeSel, mosqueSel, yearSel, langSel)),
    table);
}
