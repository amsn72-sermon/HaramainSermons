// قوالبُ التصدير: مجمَّعاتُ العام وكليشاتُ الخطبة المفردة في بابٍ واحد
//   (ملاحظتا ٤٠٩ و٤١٢)
//
//   القوالبُ لا تُستعمَل إلا من الأرشيفَين، فموضعُها بجوارِ ما تخدمه.
//   وزرٌّ واحدٌ «+ قالب جديد» يسأل عن النوع ثم يفتح محرِّرَه.
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { isManager, can } from '../store.js';
import { LH_DEFAULT, normLh, uploadLhImage } from '../letterhead.js';
import { PAGE, LETTERHEAD } from '../page.js';
import { unifiedPanel } from '../unipanel.js';

const mayDesign = () => isManager() || can('arch_design') || can('arch_edit');

export async function render() {
  const list = h('div.stack');
  const box = h('div.stack');

  async function load() {
    let rows = [];
    try { rows = await db.rpc('export_templates') || []; } catch (e) { toast(e.message, 'bad'); }
    const books = rows.filter(r => r.kind === 'book');
    const lhs = rows.filter(r => r.kind === 'letterhead');

    const card = (r) => {
      const open = r.kind === 'book'
        ? h('a.btn.sm', { href: `/app/book-design?id=${r.id}` }, 'افتحْه')
        : h('button.btn.sm', { type: 'button', onclick: () => lhEditor(r.id) }, 'افتحْها');
      const del = mayDesign()
        ? h('button.btn.sm.ghost', { type: 'button' }, 'حذف') : null;
      if (del) {
        del.onclick = () => busy(del, async () => {
          if (!await confirm(`حذفُ «${r.name}»؟`)) return;
          try {
            await db.rpc(r.kind === 'book' ? 'delete_book_template' : 'delete_letterhead',
              { p_id: r.id });
            toast('حُذف.', 'ok');
            load();
          } catch (e) { toast(e.message, 'bad'); }
        });
      }
      return h('div.card.row.between.wrap.tpl-row',
        h('div.stack', { style: { gap: '2px' } },
          h('b', r.name, r.is_default ? h('span.badge.ok', 'الأصل') : null),
          h('span.small.muted', r.kind === 'book' ? 'قالبُ مجمَّعٍ سنوي' : 'كليشةُ خطبةٍ مفردة',
            r.updated_at ? ` · ${fmtDate(r.updated_at)}` : '')),
        h('div.row', open, del));
    };

    fill(list,
      h('h3', 'قوالبُ المجمَّع السنوي'),
      books.length ? h('div.stack', ...books.map(card))
        : h('p.small.muted', 'لا قالبَ بعد.'),
      h('h3', 'كليشاتُ الخطبة المفردة'),
      h('div.card.row.between.wrap.tpl-row',
        h('div.stack', { style: { gap: '2px' } },
          h('b', 'كليشةُ الهيئة', h('span.badge.ok', 'الأصل')),
          h('span.small.muted', 'مرفقةٌ بالمنصة ولا تُعدَّل')),
        h('div.row')),
      lhs.length ? h('div.stack', ...lhs.map(card))
        : h('p.small.muted', 'ولا كليشةَ أخرى بعد.'));
  }

  // ـــ محرِّرُ الكليشة: صورةٌ تملأ الصفحةَ وهوامشُ الكتابة عليها
  async function lhEditor(id) {
    let name = '';
    let tpl = LH_DEFAULT();
    let isDefault = false;
    if (id) {
      try {
        const r = await db.rpc('letterhead_get', { p_id: id });
        const row = (Array.isArray(r) ? r[0] : r) || {};
        name = row.name || '';
        isDefault = !!row.is_default;
        tpl = normLh(row.tpl);
      } catch (e) { return toast(e.message, 'bad'); }
    }

    const nameIn = h('input', { value: name, maxlength: 60, 'aria-label': 'اسم الكليشة' });
    const defIn = h('input', { type: 'checkbox', checked: isDefault ? true : null,
      'aria-label': 'الكليشةُ الأصل' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp',
      'aria-label': 'صورة الكليشة' });
    const sheet = h('div.lh-sheet');
    const win = h('div.lh-win');
    sheet.append(h('img.lh-bg', { alt: '' }), win);

    const num = (key, label, max) => {
      const i = h('input', { type: 'number', min: '0', max: String(max), step: '1',
        value: String(tpl.page[key]), 'aria-label': label });
      i.oninput = () => {
        tpl.page[key] = Math.max(0, Math.min(max, Number(i.value) || 0));
        paint();
      };
      return h('label.field', label, i);
    };

    const paint = async () => {
      const img = sheet.querySelector('.lh-bg');
      if (tpl.bg) {
        try { img.src = await storage.signedUrl('brand', tpl.bg, 1800); }
        catch { img.src = LETTERHEAD; }
      } else img.src = LETTERHEAD;
      const p = tpl.page;
      win.style.top = `${(p.top / PAGE.h) * 100}%`;
      win.style.height = `${((PAGE.h - p.top - p.bottom) / PAGE.h) * 100}%`;
      win.style.insetInlineStart = `${(p.side / PAGE.w) * 100}%`;
      win.style.width = `${((PAGE.w - p.side * 2) / PAGE.w) * 100}%`;
    };

    file.onchange = () => busy(file, async () => {
      const fl = file.files[0];
      if (!fl) return;
      try {
        tpl.bg = await uploadLhImage(fl);
        toast('رُفعت الصورة — احفظِ الكليشة لتثبيتها.', 'ok');
        paint();
      } catch (e) { toast(e.message, 'bad'); }
    });

    const saveBtn = h('button.btn.primary', { type: 'button' }, '💾 احفظِ الكليشة');
    saveBtn.onclick = () => busy(saveBtn, async () => {
      if (nameIn.value.trim().length < 2) return toast('اكتبْ اسمَ الكليشة.', 'bad');
      try {
        const newId = await db.rpc('save_letterhead', {
          p_id: id || null, p_name: nameIn.value.trim(),
          p_tpl: tpl, p_default: !!defIn.checked });
        id = newId || id;
        toast('حُفظت الكليشة.', 'ok');
        load();
      } catch (e) { toast(e.message, 'bad'); }
    });
    const backBtn = h('button.btn.sm.ghost', { type: 'button' }, '→ القوالب');
    backBtn.onclick = () => { fill(box); load(); };

    // الكليشةُ أعلى، فشريطُ القوائم، فإطارٌ ثابتُ الأبعاد (ملاحظة ٤١٠)
    const uni = unifiedPanel({
      stage: sheet, measure: sheet, height: 360,
      tabs: [
        { key: 'name', icon: '▤', label: 'اسمُ الكليشة', hint: 'به تُعرَف عند التصدير',
          make: () => h('div.uni-grid',
            h('label.field.wide', 'اسمُ الكليشة', nameIn),
            h('label.check', defIn, h('span', 'اجعلْها الكليشةَ الأصل'))) },
        { key: 'bg', icon: '🏞', label: 'صورةُ الكليشة', hint: 'تصميمٌ خارجيٌّ يملأ الصفحة',
          make: () => h('div.stack',
            h('p.small.muted', 'A4 قائمٌ ٢١٠×٢٩٧ مم، ودقّةُ ٣٠٠ نقطةٍ أحسن.'),
            h('label.field', 'ارفعِ الصورة', file)) },
        { key: 'page', icon: '▣', label: 'موضعُ الكتابة', hint: 'هوامشُ النصِّ على الكليشة',
          make: () => h('div.stack',
            h('div.uni-grid',
              num('top', 'هامشُ الرأس مم', 150),
              num('bottom', 'هامشُ الذيل مم', 150),
              num('side', 'الهامشُ الجانبيُّ مم', 90)),
            h('p.small.muted', 'المستطيلُ على الكليشة هو موضعُ الكتابة.')) }
      ]
    });
    uni.foot.append(saveBtn, backBtn);
    fill(box, h('div.card.stack.lh-wrap',
      h('b', id ? `كليشة: ${name}` : 'كليشةٌ جديدة'), uni.el));
    paint();
  }

  // ـــ زرٌّ واحدٌ يسأل عن النوع
  async function newTpl() {
    const kind = await dialog({
      title: 'قالبٌ جديد',
      body: h('div.stack',
        h('p.small.muted', 'المجمَّعُ كتابُ العام بصفحاته، والكليشةُ ورقةُ الخطبة المفردة.')),
      buttons: [
        { label: 'مجمَّعٌ سنوي', kind: 'primary', value: 'book' },
        { label: 'كليشة', value: 'lh' },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!kind) return;
    if (kind === 'book') { location.href = '/app/book-design'; return; }
    lhEditor(null);
  }

  await load();

  return h('div',
    h('div.page-head',
      mayDesign()
        ? h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
            h('button.btn.sm.primary', { type: 'button', onclick: newTpl }, '＋ قالب جديد'))
        : null,
      h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'قوالب التصدير'),
        h('p.muted', 'قوالبُ المجمَّع السنويِّ وكليشاتُ الخطبة المفردة. '
          + 'يُختار منها عند التصدير، وكليشةُ الهيئة هي الأصل.'))),
    box,
    list);
}

export default render;
