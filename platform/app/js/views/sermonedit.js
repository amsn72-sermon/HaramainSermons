// تنقيحُ نسخةِ خطبةٍ على كليشة الهيئة ثم حفظُها (ملاحظة ٣٣٨)
//
//   الملفُّ المرفوعُ من Word يدخل بتنسيقه، وفيه ما يحتاج يدًا: سطرٌ
//   انكسر، وفقرةٌ تفرّقت، وفراغٌ زائد. وكان صاحبُه لا يراه إلا بعد
//   التصدير PDF، فيرجع إلى Word ويعيد الرفع.
//
//   فصار يُفتح هنا على الكليشة نفسِها التي يُطبَع عليها: المساحةُ
//   مساحتُها، والخطُّ خطُّها، وحدودُ الصفحات مرسومةٌ خطوطًا وهميةً لا
//   تُطبَع — فما رآه هو ما يخرج. يُنقَّح ثم يُحفَظ في النسخة نفسِها.
import { h, fill, toast, busy, dialog, confirm, fmtHijri, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { langName, langDir, MOSQUE, isManager, can } from '../store.js';
import { createEditor } from '../editor.js';
import { dataCard } from '../page.js';
import { asExportArgs } from '../sermondl.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');

const mayEdit = () => isManager() || can('arch_refine') || can('arch_edit');

export async function render(ctx) {
  const id = ctx?.params?.id;
  if (!id) return h('p.muted', 'لم تُحدَّد الخطبة.');

  let s = {};
  try {
    const r = await db.rpc('arch_sermon', { p_id: id });
    s = (Array.isArray(r) ? r[0] : r) || {};
  } catch (e) { return h('p.small.bad', e.message); }
  if (!s.id) return h('p.muted', 'لم تُوجد الخطبة.');

  const vs = (s.versions || []).filter(v => v.has_text || v.has_file);
  if (!vs.length) {
    return h('div',
      h('div.page-head', h('div.grow',
        h('div.eyebrow', 'الأرشيف'), h('h1', s.title || 'خطبة'),
        h('p.muted', 'لا نصَّ محفوظٌ في نسخةٍ من هذه الخطبة بعد.'))),
      h('a.btn.sm.ghost', { href: `/app/sermons/${s.h_year || ''}` }, '← إلى الأرشيف'));
  }

  const wanted = ctx?.query?.get('lang') || '';
  let code = vs.find(v => v.language_code === wanted)?.language_code
    || vs.find(v => v.has_text)?.language_code || vs[0].language_code;

  const body = h('div.stack');
  const chips = h('div.lang-chips');
  const stateLine = h('span.small.muted');

  // بطاقةُ بياناتٍ تعلو النصَّ كما تُطبَع — من بيانات الخطبة نفسِها
  const material = () => ({
    id: s.id, title: s.title || '—', material_type: 'خطب',
    sermon_type: s.sermon_type || 'خطبة جمعة', mosque: s.mosque || null,
    sermon_date: s.sermon_date || null,
    khateeb: s.khateeb ? { name: s.khateeb } : null
  });

  let editor = null;
  let current = { code: null, text: {}, dirty: false };

  const saveBtn = h('button.btn.sm.primary', { type: 'button' }, '💾 حفظ');
  const pdfBtn  = h('button.btn.sm', { type: 'button' }, '🖨 عايِنْ على الكليشة');
  const wordBtn = h('button.btn.sm.ghost', { type: 'button' }, '⤓ Word');

  async function save({ quiet = false } = {}) {
    if (!editor || !current.code) return false;
    if (!mayEdit()) { toast('تنقيحُ النصِّ بإذن مدير المشروع.', 'bad'); return false; }
    try {
      await db.rpc('save_arch_sermon', { p: {
        id: s.id, section_id: null, versions: [{
          language_code: current.code, body_html: editor.html,
          title_tr: current.text.title_tr || null,
          is_source: current.code === 'ar'
        }] } });
      current.dirty = false;
      stateLine.textContent = 'محفوظ';
      if (!quiet) toast('حُفظ التنقيح.', 'ok');
      return true;
    } catch (e) { toast(e.message, 'bad'); return false; }
  }
  saveBtn.onclick = () => busy(saveBtn, () => save());

  // الحفظُ بـ Ctrl/Cmd + S كما في كلِّ محرِّر
  const onKey = ev => {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) {
      ev.preventDefault(); save();
    }
  };
  document.addEventListener('keydown', onKey);
  const onLeave = ev => { if (current.dirty) { ev.preventDefault(); ev.returnValue = ''; } };
  window.addEventListener('beforeunload', onLeave);
  // تُنزَع المستمعاتُ متى غادرت الصفحةُ شجرةَ المستند
  const watch = new MutationObserver(() => {
    if (!page.isConnected) {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
      watch.disconnect();
    }
  });

  async function open(next) {
    if (current.dirty && next !== current.code) {
      const go = await confirm('تعديلاتٌ غير محفوظة',
        'فيها تنقيحٌ لم يُحفَظ. أتحفظه قبل الانتقال؟', 'احفظْ ثم انتقِلْ');
      if (go) { if (!await save({ quiet: true })) return; } else return;
    }
    code = next;
    fill(body, h('p.muted', 'يُحمَّل…'));
    drawChips();
    let t = {};
    try {
      const r = await db.rpc('arch_version_text', { p_sermon: s.id, p_lang: code });
      t = (Array.isArray(r) ? r[0] : r) || {};
    } catch (e) { return fill(body, h('p.small.bad', e.message)); }

    const dir = langDir(code) || (code === 'ar' ? 'rtl' : 'ltr');
    const titleTr = h('input', { value: t.title_tr || '', dir,
      'aria-label': 'عنوانُ الخطبة بلغتها',
      placeholder: code === 'ar' ? '—' : 'العنوان كما يُكتب بهذه اللغة' });

    editor = createEditor({
      html: t.body_html || '', dir, detachTools: true,
      readOnly: !mayEdit(),
      label: `نصُّ الخطبة (${code === 'ar' ? 'العربية' : langName(code)})`,
      top: dataCard(material(), code, s.khateeb || null, t.doc_no || null),
      placeholder: mayEdit() ? 'نقِّحِ النصَّ هنا…' : 'لا تملك تنقيحَ هذا النص.',
      onChange: () => { current.dirty = true; stateLine.textContent = 'تعديلاتٌ غير محفوظة'; }
    });
    current = { code, text: { title_tr: titleTr.value }, dirty: false };
    titleTr.oninput = () => {
      current.text.title_tr = titleTr.value.trim();
      current.dirty = true;
      stateLine.textContent = 'تعديلاتٌ غير محفوظة';
    };
    stateLine.textContent = t.body_html ? 'محفوظ' : 'لا نصَّ بعد — الصقْه أو اكتبْه';

    fill(body,
      h('div.row.between.wrap.ed-bar',
        editor.tools || h('span'),
        h('div.row', { style: { gap: '6px' } }, stateLine, saveBtn)),
      code === 'ar' ? null
        : h('label.field', 'عنوانُ الخطبة بهذه اللغة', titleTr,
            h('small', 'يُطبع في الصفِّ الثاني من بطاقة البيانات (ملاحظة ٣٤١)')),
      h('div.sheet-wrap', editor.page));
  }

  function drawChips() {
    fill(chips, ...vs.map(v => {
      const on = v.language_code === code;
      const b = h('button.lang-chip' + (on ? '.on' : ''), { type: 'button' },
        v.language_code === 'ar' ? 'العربية (الأصل)' : langName(v.language_code),
        v.has_text ? null : h('span.small.muted', ' — ملفٌّ فقط'));
      b.onclick = () => open(v.language_code);
      return b;
    }));
  }

  const args = async () => {
    const r = await db.rpc('arch_version_text', { p_sermon: s.id, p_lang: code });
    const t = (Array.isArray(r) ? r[0] : r) || {};
    // ما في المحرِّر الآن هو الذي يُعايَن، ولو لم يُحفَظ بعد
    if (editor) t.body_html = editor.html;
    return asExportArgs(s, { language_code: code }, t);
  };
  pdfBtn.onclick = () => busy(pdfBtn, async () => {
    const { printTranslation } = await import('../export.js');
    if (!printTranslation(await args(), { autoPrint: false })) {
      toast('اسمح بالنوافذ المنبثقة للمعاينة.', 'bad');
    }
  });
  wordBtn.onclick = () => busy(wordBtn, async () => {
    const { downloadDocx } = await import('../export.js');
    try { await downloadDocx(await args()); } catch (e) { toast(e.message, 'bad'); }
  });

  await open(code);

  const page = h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        pdfBtn, wordBtn,
        h('a.btn.sm.ghost', { href: `/app/sermons/${s.h_year || ''}` }, '← الأرشيف')),
      h('div.grow',
        h('div.eyebrow', 'تنقيحٌ على الكليشة'),
        h('h1', s.title || 'خطبة'),
        h('p.muted',
          [s.sermon_type, MOSQUE[s.mosque], s.khateeb,
           s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : null),
           s.sermon_date ? fmtDate(s.sermon_date) : null].filter(Boolean).join(' · ')),
        s.doc_no ? h('span.doc-no', { dir: 'ltr' }, s.doc_no) : null)),
    h('p.small.muted', 'ما تراه هنا هو ما يخرج في الطباعة: المساحةُ والخطُّ وحدودُ '
      + 'الصفحات. والخطوطُ الوهميةُ تُري موضعَ انقطاع الصفحة ولا تُطبَع.'),
    chips,
    body);
  watch.observe(document.body, { childList: true, subtree: true });
  return page;
}

export default render;
