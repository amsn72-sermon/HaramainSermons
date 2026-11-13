// تنسيقُ نسخةٍ مؤرشفةٍ على كليشة الهيئة (ملاحظة ٦ من دفعة ٥٠٢)
//
//   الخطبةُ إذا اكتمل مسارُها أُغلق بابُ تعديلها، وهذا هو الأصل. وهذه
//   الشاشةُ بابٌ ضيِّقٌ لمن مُنح مفتاحَها: يُصلِح الصورةَ — فقرةً التصقت،
//   أو تنسيقًا اختلَّ — لا المعنى. وكلُّ حفظٍ يُبقي النصَّ السابقَ في
//   سجلِّ النسخة، ويُكتَب من عدَّل ومتى، ويُرَدُّ النصُّ إلى أيِّ صورةٍ منه.
import { h, fill, toast, busy, dialog, fmtDateTime, fmtSermonDate } from '../ui.js';
import { db } from '../sb.js';
import { langName, can } from '../store.js';
import { createEditor } from '../editor.js';
import { dataCard } from '../page.js';

const MOSQUE = { makkah: 'المسجد الحرام', madinah: 'المسجد النبوي' };

export async function render(ctx) {
  const id = ctx?.params?.id;
  if (!can('arch_fix')) {
    return h('div.card', h('p.bad', 'تنسيقُ النسخ المؤرشفة مغلقٌ على حسابك — راجعْ مديرَ المشروع.'));
  }

  let v = null;
  try {
    const r = await db.rpc('fix_text', { p_track: id });
    v = Array.isArray(r) ? r[0] : r;
  } catch (e) { return h('div.card', h('p.bad', e.message)); }
  if (!v) return h('div.card', h('p.bad', 'لا نسخةَ بهذا الرقم، أو أنها محذوفة.'));

  const title = `${v.title || '—'} — ${langName(v.language_code) || v.language_code}`;
  const stateLine = h('span.small.muted', 'محفوظة');
  let dirty = false;

  const m = {
    title: v.title, mosque: v.mosque, material_type: v.material_type,
    sermon_type: v.sermon_type, sermon_date: v.sermon_date,
    khateeb: v.khateeb ? { name: v.khateeb } : null
  };
  const editor = createEditor({
    html: v.html || '', dir: 'auto', lang: v.language_code,
    label: `النص — ${langName(v.language_code)}`,
    top: dataCard(m, v.language_code, v.khateeb || null, v.doc_no || null),
    placeholder: 'النصُّ المحفوظ…',
    onChange: () => { dirty = true; stateLine.textContent = 'تعديلاتٌ غير محفوظة'; }
  });

  const saveBtn = h('button.btn.sm.primary', { type: 'button' }, '💾 حفظُ التنسيق');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    if (!dirty) { toast('لا تعديلَ ليُحفَظ.', 'warn'); return; }
    const why = await dialog({
      title: 'حفظُ التنسيق',
      body: h('div.stack',
        h('p.small.muted', 'يُحفَظ النصُّ السابقُ في سجلِّ هذه النسخة قبل الكتابة، '
          + 'فيُرجَع إليه متى شئت. واكتبْ سببَ الإصلاح ليُعرَف في السجلّ.'),
        h('label.field', 'السبب', h('input', { id: 'fx-why',
          placeholder: 'تنسيقٌ اختلَّ، فقرةٌ التصقت…', maxlength: 200 }))),
      buttons: [
        { label: 'احفظْ', kind: 'primary',
          value: () => (document.getElementById('fx-why')?.value || '').trim() },
        { label: 'إلغاء', value: null }
      ]
    });
    if (why === null) return;
    try {
      await db.rpc('fix_translation', { p_track: id, p_html: editor.html, p_reason: why });
      dirty = false;
      stateLine.textContent = 'حُفظت ' + fmtDateTime(new Date());
      toast('حُفظ التنسيق.', 'ok');
      loadLog();
    } catch (e) { toast(e.message, 'bad'); }
  });

  // سجلُّ الإصلاح: من عدَّل ومتى، والردُّ إلى صورةٍ سابقة
  const logBox = h('div.stack');
  const loadLog = async () => {
    try {
      const r = await db.rpc('fix_history', { p_track: id });
      const rows = Array.isArray(r) ? r : [];
      fill(logBox, rows.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['الوقت', 'من عدَّل', 'السبب', 'الحجم', ''].map(t => h('th', t)))),
            h('tbody', rows.map(x => h('tr',
              h('td', { 'data-label': 'الوقت' }, fmtDateTime(x.at)),
              h('td', { 'data-label': 'من' }, x.by_whom || '—'),
              h('td', { 'data-label': 'السبب' }, x.reason || '—'),
              h('td', { 'data-label': 'الحجم' }, String(x.chars || 0)),
              h('td', h('button.btn.xs', { type: 'button',
                title: 'ردُّ النصِّ إلى هذه الصورة',
                onclick: e => busy(e.currentTarget, async () => {
                  try {
                    await db.rpc('fix_restore', { p_history: x.id });
                    toast('رُدَّ النصُّ إلى صورته. أعِدْ فتحَ الشاشة.', 'ok');
                    loadLog();
                  } catch (err) { toast(err.message, 'bad'); }
                }) }, '↩ ردّ')))))))
        : h('p.small.muted', 'لم يُصلَحْ شيءٌ بعد.'));
    } catch (e) { fill(logBox, h('p.bad', e.message)); }
  };
  loadLog();

  // تحذيرٌ عند المغادرة بتعديلٍ غير محفوظ
  const warn = ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } };
  addEventListener('beforeunload', warn);

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الأرشيف'),
      h('h1', 'تنسيقُ نسخةٍ مؤرشفة'),
      h('p.muted', [title, v.doc_no, MOSQUE[v.mosque],
        v.sermon_date ? fmtSermonDate(v.sermon_date) : ''].filter(Boolean).join(' · '))),
      h('div.row', { style: { marginInlineStart: 'auto' } }, stateLine, saveBtn)),
    h('p.small.muted', 'هذا البابُ لإصلاح الصورة لا لتبديل المعنى. '
      + 'وكلُّ حفظٍ مسجَّلٌ باسمك ووقته، والنصُّ السابقُ محفوظٌ يُرجَع إليه.'),
    editor.el,
    h('div.card.stack', { style: { marginTop: '18px' } },
      h('h3', 'سجلُّ الإصلاح'), logBox));
}
