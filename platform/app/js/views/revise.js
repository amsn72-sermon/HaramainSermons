// إعادة تنشيط الخطبة للتعديل على أصلها (ملاحظة ٢٨)
// التعديل يأتي غالبًا من الشيخ على نصه العربي، فيُحدَّد على الأصل لا على الترجمة.
import { h, toast, busy, dialog, fmtDateTime } from '../ui.js';
import { db, storage, auth } from '../sb.js';
import { state, langName, isAdmin, stageName } from '../store.js';
import { heading } from '../page.js';
import { pdfViewer, MARK_KINDS } from '../pdfview.js';

const REV_SELECT = '*,marks:revision_marks(*),by:profiles!material_revisions_created_by_fkey(full_name),source:material_sources(path,version,note)';

export const kindTag = k => h('span.kind-tag', { 'data-kind': k }, MARK_KINDS[k] || k);

// آخر جولة تعديل مفتوحة على الخطبة، بتحديداتها
export async function openRevision(materialId) {
  const rows = await db.select('material_revisions', {
    select: REV_SELECT, material_id: `eq.${materialId}`, closed_at: 'is.null',
    order: 'round.desc', limit: '1'
  }).catch(() => []);
  const r = rows[0];
  if (r) r.marks = (r.marks || []).sort((a, b) => a.page - b.page || a.y - b.y);
  return r || null;
}

// لوحة «التعديل المطلوب» التي يراها المترجم وأصحاب المراحل
export function revisionCard(rev) {
  const modeText = { annotate: 'تعديل محدَّد على أصل الخطبة', new_source: 'أُرفق أصل جديد معدّل من الشيخ', note: 'ملاحظة تعديل' };
  return h('div.revision-box',
    h('div.eyebrow', `التعديل المطلوب — الجولة ${rev.round}`),
    h('p', { style: { margin: '4px 0' } }, modeText[rev.mode] || ''),
    rev.note && h('p', h('b', 'الملاحظة: '), rev.note),
    rev.redo_audio && h('p.small', 'التعديل يستوجب تسجيلًا صوتيًا جديدًا.'),
    rev.marks?.length ? h('ol.marks', rev.marks.map(m =>
      h('li', kindTag(m.kind), h('span', `صفحة ${m.page}`), m.note && h('span', ` — ${m.note}`)))) : null,
    h('p.small.muted', `${rev.by?.full_name || ''} · ${fmtDateTime(rev.created_at)}`));
}

// ---------------------------------------------------------------------
// نافذة إعادة التنشيط: نوع التعديل، اللغات، المرحلة، التسجيل الصوتي
// ---------------------------------------------------------------------
export async function reopenDialog(material, onDone) {
  const tracks = await db.select('tracks', {
    select: 'id,language_code,status,stages:track_stages!track_stages_track_id_fkey(stage_key,sort)',
    material_id: `eq.${material.id}`, order: 'language_code.asc'
  });
  if (!tracks.length) return toast('لا توجد لغات لهذه الخطبة.', 'bad');

  const modes = [
    ['annotate', 'تحديد التعديل على أصل الخطبة (تظليل + نوع التعديل)'],
    ['new_source', 'إرفاق ملف أصل جديد موضّح فيه التعديل'],
    ['note', 'ملاحظة نصية عامة']
  ];
  const mode = h('div.stack', { style: { gap: '8px' } }, modes.map(([v, label], i) =>
    h('label.check', h('input', { type: 'radio', name: 'rev-mode', value: v, checked: i === 0 ? true : null }), label)));
  const file = h('input', { type: 'file', accept: 'application/pdf' });
  const fileRow = h('label.field', { hidden: true }, 'ملف الأصل الجديد (PDF)', file);
  const note = h('textarea', { rows: '3', placeholder: 'ما المطلوب تعديله؟' });
  const langs = h('div.stack', { style: { gap: '6px' } }, tracks.map(t =>
    h('label.check', h('input', { type: 'checkbox', value: t.id, checked: true }), langName(t.language_code))));
  const stageKeys = [...new Set(tracks.flatMap(t => (t.stages || []).sort((a, b) => a.sort - b.sort).map(s => s.stage_key)))];
  const stage = h('select', stageKeys.map(k => h('option', { value: k, selected: k === 'translation' ? true : null }, stageName(k))));
  const redo = h('input', { type: 'checkbox' });

  mode.addEventListener('change', () => {
    fileRow.hidden = mode.querySelector('input:checked').value !== 'new_source';
  });

  const chosen = () => [...langs.querySelectorAll('input:checked')].map(i => i.value);
  const value = await dialog({
    title: `إعادة تنشيط: ${heading(material)} (${material.title})`,
    body: h('div.stack', { style: { gap: '14px' } },
      h('label.field', 'نوع التعديل', mode),
      fileRow,
      h('label.field', 'ملاحظة التعديل', note),
      h('label.field', 'اللغات التي يشملها التعديل', langs),
      h('label.field', 'تعود إلى مرحلة', stage),
      h('label.check', redo, 'يلزم تسجيل صوتي جديد')),
    buttons: [
      { label: 'إعادة التنشيط', kind: 'primary', validate: () => {
        const m = mode.querySelector('input:checked').value;
        if (!chosen().length) { toast('اختر لغة واحدة على الأقل.', 'bad'); return false; }
        if (m === 'note' && note.value.trim().length < 3) { toast('اكتب ملاحظة التعديل.', 'bad'); return false; }
        if (m === 'new_source' && !file.files[0]) { toast('اختر ملف الأصل الجديد.', 'bad'); return false; }
        return true;
      }, value: () => ({ mode: mode.querySelector('input:checked').value, note: note.value.trim(),
        tracks: chosen(), stage: stage.value, redo: redo.checked, file: file.files[0] || null }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!value) return;

  let sourceId = null;
  if (value.mode === 'new_source') {
    const path = await storage.upload('sources', `${crypto.randomUUID()}.pdf`, value.file);
    sourceId = await db.rpc('add_source_version', { p_material: material.id, p_path: path, p_note: value.note || null });
  }
  await db.rpc('reopen_material', {
    p_material: material.id, p_mode: value.mode, p_note: value.note || null,
    p_tracks: value.tracks, p_stage: value.stage, p_redo_audio: value.redo, p_source: sourceId
  });
  toast('أُعيد تنشيط الخطبة للتعديل.', 'ok');
  onDone && onDone(value.mode);
}

// ---------------------------------------------------------------------
// شاشة التحديد على الأصل: يرسم المنسق مستطيلًا ويختار نوع التعديل
// ---------------------------------------------------------------------
export async function render(ctx) {
  const id = ctx.params.material;
  const [material] = await db.select('materials', { select: '*,khateeb:khateebs(name)', id: `eq.${id}`, limit: '1' });
  if (!material) return h('p.err', 'الخطبة غير موجودة.');
  let rev = await openRevision(id);
  if (!rev) return h('div.stack',
    h('p.muted', 'لا توجد جولة تعديل مفتوحة على هذه الخطبة.'),
    h('a.btn', { href: '/app/archive' }, 'رجوع إلى الأرشيف'));

  const list = h('div');
  const viewerBox = h('div', h('p.muted', 'جارٍ تحميل الأصل…'));
  let viewer = null;

  async function refresh() {
    rev = await openRevision(id);
    viewer && viewer.setMarks(rev.marks || []);
    draw();
  }
  function draw() {
    list.replaceChildren(rev.marks?.length
      ? h('ol.marks', rev.marks.map(m => h('li',
        kindTag(m.kind), h('span', `صفحة ${m.page}`), m.note && h('span', ` — ${m.note}`), ' ',
        h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
          await db.rpc('delete_revision_mark', { p_id: m.id });
          await refresh();
        }).catch(err => toast(err.message, 'bad')) }, 'حذف'))))
      : h('p.muted', 'لم تُحدَّد مواضع بعد. اسحب بالمؤشر على الأصل لتحديد موضع التعديل.'));
  }

  async function askKind(rect) {
    const kind = h('select', Object.entries(MARK_KINDS).map(([k, label]) => h('option', { value: k }, label)));
    const note = h('input', { type: 'text', placeholder: 'وصف مختصر للتعديل' });
    const v = await dialog({
      title: `تحديد تعديل — صفحة ${rect.page}`,
      body: h('div.stack', { style: { gap: '12px' } },
        h('label.field', 'نوع التعديل', kind), h('label.field', 'الملاحظة', note)),
      buttons: [{ label: 'حفظ التحديد', kind: 'primary', value: () => ({ kind: kind.value, note: note.value.trim() }) },
        { label: 'إلغاء', value: null }]
    });
    if (!v) return;
    await db.rpc('add_revision_mark', { p_revision: rev.id, p_page: rect.page,
      p_x: rect.x, p_y: rect.y, p_w: rect.w, p_h: rect.h, p_kind: v.kind, p_note: v.note || null });
    await refresh();
    toast('حُفظ التحديد.', 'ok');
  }

  if (material.source_pdf_path) {
    storage.signedUrl('sources', material.source_pdf_path, 600).then(url => {
      const who = auth.user?.email || state.profile?.full_name || '';
      viewer = pdfViewer({ url, lines: [who], marks: rev.marks || [], onDraw: rect => askKind(rect).catch(err => toast(err.message, 'bad')) });
      viewerBox.replaceChildren(viewer);
    }).catch(err => viewerBox.replaceChildren(h('p.err', err.message)));
  } else {
    viewerBox.replaceChildren(h('p.muted', 'هذه الخطبة أصلها نص مكتوب لا ملف PDF — استخدم الملاحظة النصية.'));
  }
  draw();

  return h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', `تحديد التعديل على الأصل — الجولة ${rev.round}`),
        h('h1', `${heading(material)} (${material.title})`)),
      h('div.row',
        h('a.btn.sm', { href: '/app/archive' }, 'رجوع'),
        isAdmin() ? h('button.btn.sm.primary', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
          await db.rpc('close_revision', { p_revision: rev.id });
          toast('أُغلقت جولة التعديل.', 'ok');
          ctx.navigate('/app/archive');
        }).catch(err => toast(err.message, 'bad')) }, 'إنهاء التحديد') : null)),
    h('p.small.muted', 'اسحب بالمؤشر على موضع التعديل في الأصل، ثم اختر نوعه. يرى المترجم هذه التحديدات فوق الأصل نفسه.'),
    h('div.workspace', h('div.ws-col', viewerBox), h('div.ws-col', h('h3', 'التعديلات المحدَّدة'), list)));
}
