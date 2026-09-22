// مهامي، ومساحة عمل المهمة لكل الأدوار
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDateTime, fmtSermonDate, fmtMinutes } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager, TRACK_SELECT, MOSQUE, PRIORITY, EVENT_LABEL, sortStages, currentStage,
  langName, langDir, stageName } from '../store.js';
import { statusBadge, trackTimer, progressBar, stageStrip, lateSummary } from './parts.js';
import { createEditor } from '../editor.js';
import { setSafeHtml } from '../sanitize.js';
import { downloadDocx, printTranslation } from '../export.js';

const FULL = `${TRACK_SELECT},material:materials(*,khateeb:khateebs(name))`;
const myStages = t => t.stages.filter(s => s.assignee_id === state.profile.id);

function needsMe(t) {
  if (t.status === 'awaiting_receipt') return t.stages[0]?.assignee_id === state.profile.id;
  return currentStage(t)?.assignee_id === state.profile.id;
}

// ---------------------------------------------------------------------
export async function list() {
  const all = await db.select('tracks', { select: FULL, order: 'created_at.desc', limit: 300 });
  const tracks = all.map(sortStages).filter(t => myStages(t).length);
  const now = tracks.filter(needsMe);
  const upcoming = tracks.filter(t => !needsMe(t) && t.status !== 'completed' && myStages(t).some(s => s.status === 'waiting'));
  const done = tracks.filter(t => !now.includes(t) && !upcoming.includes(t));

  const card = t => h('div.card', h('div.row',
    h('div', { style: { flex: 1, minWidth: '220px' } },
      h('b', `${t.material.title} — ${langName(t.language_code)}`),
      h('div.small.muted', [t.material.sermon_type || t.material.material_type, MOSQUE[t.material.mosque], t.material.priority !== 'normal' && PRIORITY[t.material.priority]].filter(Boolean).join(' · ')),
      h('div.small', 'دوري: ', myStages(t).map(s => stageName(s.stage_key)).join('، ')),
      lateSummary(t)),
    h('div', statusBadge(t), h('div', trackTimer(t))),
    h('div', { style: { minWidth: '140px' } }, progressBar(t)),
    h('a.btn', { class: needsMe(t) ? 'primary' : '', href: `/app/tasks/${t.id}` }, needsMe(t) ? (t.status === 'awaiting_receipt' ? 'استلام' : 'فتح والعمل') : 'عرض')));

  const section = (title, items, emptyText) => h('section', { style: { marginBottom: '24px' } },
    h('h2', `${title} (${items.length})`), items.length ? h('div.stack', items.map(card)) : h('p.muted', emptyText));

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'مساحة العمل'), h('h1', 'مهامي'))),
    tracks.length ? h('div',
      section('تحتاج إجراءً منك الآن', now, 'لا شيء بانتظارك حاليًا.'),
      section('قادمة', upcoming, 'لا مراحل قادمة مسندة إليك.'),
      section('أنجزت دوري فيها', done, '—'))
      : emptyState('لا مهام مسندة إليك بعد', 'ستظهر هنا فور إسناد المنسق مادةً إليك.'));
}

// ---------------------------------------------------------------------
export async function workspace(ctx) {
  const [t] = await db.select('tracks', { select: FULL, id: `eq.${ctx.params.id}` });
  if (!t) return emptyState('المهمة غير متاحة', 'قد لا تكون مسندة إليك، أو حُذفت.', h('a.btn', { href: '/app/tasks' }, 'مهامي'));
  sortStages(t);
  const m = t.material;
  const events = await db.select('track_events', { select: '*,actor:profiles(full_name)', track_id: `eq.${t.id}`, order: 'created_at.asc' });
  const cur = currentStage(t);
  const curDef = cur && state.stages.find(s => s.key === cur.stage_key);
  const me = state.profile.id;
  const mine = cur?.assignee_id === me;
  const canAccept = t.status === 'awaiting_receipt' && t.stages[0]?.assignee_id === me;
  const canEdit = mine && curDef?.assignee_role === 'translator';
  const dir = langDir(t.language_code);
  const reload = () => ctx.navigate(location.pathname, { replace: true });
  const exportArgs = { material: m, track: t, khateeb: m.khateeb?.name };

  // ----- المصدر العربي -----
  const sourceBox = h('div.source-text', { dir: 'rtl', lang: 'ar' });
  if (m.source_html) setSafeHtml(sourceBox, m.source_html);
  else if (m.source_pdf_path) {
    sourceBox.append(h('p', 'الأصل ملف PDF.'));
    storage.signedUrl('sources', m.source_pdf_path).then(url => sourceBox.replaceChildren(
      h('iframe', { src: url, title: 'الأصل العربي', style: { width: '100%', height: '70vh', border: 0, borderRadius: '8px' } }),
      h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, 'فتح الملف في نافذة'))).catch(err => toast(err.message, 'bad'));
  }

  // ----- الترجمة -----
  let dirty = false;
  const editor = createEditor({ html: t.translation_html || '', dir, readOnly: !canEdit, label: `الترجمة (${langName(t.language_code)})`,
    placeholder: 'اكتب الترجمة كاملة هنا…', onChange: () => { dirty = true; saveState.textContent = 'تعديلات غير محفوظة'; } });
  const saveState = h('span.small.muted', t.translation_html ? 'محفوظة' : 'مسودة فارغة');
  async function saveDraft(silent = false) {
    if (!canEdit || !dirty) return;
    await db.rpc('save_translation', { p_track: t.id, p_html: editor.html });
    t.translation_html = editor.html; dirty = false; saveState.textContent = 'محفوظة ' + fmtDateTime(new Date());
    if (!silent) toast('حُفظت المسودة.', 'ok');
  }
  // حفظ تلقائي كل دقيقة، وتنبيه عند مغادرة الصفحة بتعديلات غير محفوظة
  const autosave = setInterval(() => { if (!editor.el.isConnected) return clearInterval(autosave); saveDraft(true).catch(() => {}); }, 60_000);
  window.onbeforeunload = () => (dirty ? true : undefined);

  // ----- التسجيل الصوتي -----
  const audioBox = h('div.stack', { style: { gap: '8px' } });
  function drawAudio() {
    fill(audioBox,
      t.audio_path ? h('audio', { controls: true, src: storage.publicUrl('audio', t.audio_path), style: { width: '100%' } }) : h('p.small.muted', 'لم يُرفع تسجيل بعد.'),
      mine && canEdit ? (() => {
        const file = h('input', { type: 'file', accept: 'audio/*' });
        return h('div.row', file, h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
          const f = file.files[0];
          if (!f) return toast('اختر ملف التسجيل.', 'bad');
          if (!f.type.startsWith('audio/')) return toast('الملف ليس تسجيلًا صوتيًا.', 'bad');
          if (f.size > 200 * 1024 * 1024) return toast('الحد الأقصى ٢٠٠ ميغابايت.', 'bad');
          try {
            const ext = (f.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
            const path = await storage.upload('audio', `${t.id}/${crypto.randomUUID()}.${ext}`, f);
            await db.rpc('set_track_audio', { p_track: t.id, p_path: path });
            t.audio_path = path; drawAudio(); toast('رُفع التسجيل.', 'ok');
          } catch (err) { toast(err.message, 'bad'); }
        }) }, 'رفع التسجيل'));
      })() : null);
  }
  drawAudio();

  // ----- الإجراءات -----
  const note = h('textarea', { placeholder: 'ملاحظة للمرحلة التالية أو للمنسق (اختياري)', rows: 2 });
  const checklist = h('input', { type: 'checkbox' });
  const blockersBox = h('div.form-errors', { hidden: true, role: 'alert' });
  const nextStage = cur && t.stages.find(s => s.sort > cur.sort);

  async function doComplete(btn) {
    await busy(btn, async () => {
      try {
        await saveDraft(true);
        // التحقق أولًا: لا تظهر نافذة التأكيد لطلب سيُرفض
        const blockers = await db.rpc('stage_blockers', { p_track: t.id, p_checklist: checklist.checked });
        if (blockers?.length) {
          blockersBox.replaceChildren(h('ul', blockers.map(b => h('li', b)))); blockersBox.hidden = false;
          blockersBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        blockersBox.hidden = true;
        const target = nextStage ? `${stageName(nextStage.stage_key)} — ${nextStage.assignee?.full_name}` : 'الاعتماد النهائي والنشر على الموقع العام';
        const ok = await confirm('تأكيد إتمام المرحلة', `بعد التأكيد تنتقل المهمة إلى: ${target}، ولا يعود التعديل متاحًا لك إلا إذا أُعيدت إليك.`, 'تأكيد الإتمام والإرسال');
        if (!ok) return;
        await db.rpc('complete_stage', { p_track: t.id, p_checklist: checklist.checked, p_note: note.value.trim() || null });
        window.onbeforeunload = null;
        toast(nextStage ? `انتقلت المهمة إلى ${stageName(nextStage.stage_key)}.` : 'اكتمل المسار ونُشرت الترجمة.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  async function doReturn() {
    const earlier = t.stages.filter(s => cur && s.sort < cur.sort);
    if (!earlier.length) return;
    const target = h('select', earlier.map(s => h('option', { value: s.stage_key }, `${stageName(s.stage_key)} — ${s.assignee?.full_name}`)));
    target.value = earlier[earlier.length - 1].stage_key;
    const reason = h('textarea', { rows: 4, placeholder: 'وضّح التعديلات المطلوبة', required: true });
    const err = h('p.err', { hidden: true }, 'اكتب سبب الإعادة (٣ أحرف على الأقل).');
    const chosen = await dialog({
      title: 'إعادة المهمة للتعديل',
      body: h('div.stack', h('label.field', 'إعادة إلى', target), h('label.field', 'سبب الإعادة — مطلوب', reason), err),
      onOpen: () => reason.focus(),
      buttons: [
        { label: 'تأكيد الإعادة', kind: 'primary', validate: () => { const ok = reason.value.trim().length >= 3; err.hidden = ok; return ok; },
          value: () => ({ target: target.value, reason: reason.value.trim() }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!chosen) return;
    try {
      await saveDraft(true);
      await db.rpc('return_stage', { p_track: t.id, p_target: chosen.target, p_reason: chosen.reason });
      window.onbeforeunload = null;
      toast(`أُعيدت المهمة إلى ${stageName(chosen.target)} مع سبب الإعادة.`, 'ok'); reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  let actions = null;
  if (canAccept) {
    actions = h('div.card', h('h3', 'استلام المهمة'),
      h('p', 'بعد الاستلام يبدأ احتساب وقت الترجمة: ', h('b', fmtMinutes(t.stages[0]?.planned_minutes)), '.'),
      h('button.btn.primary', { onclick: e => busy(e.currentTarget, async () => {
        try { await db.rpc('accept_track', { p_track: t.id }); toast('تم تسجيل استلامك. يمكنك البدء.', 'ok'); reload(); }
        catch (err) { toast(err.message, 'bad'); }
      }) }, 'استلام المهمة وقبولها'));
  } else if (mine) {
    const isCoord = curDef.assignee_role === 'coordinator';
    const isMgr = curDef.assignee_role === 'manager';
    actions = h('div.card.stack',
      h('h3', `دورك: ${stageName(cur.stage_key)}`),
      blockersBox,
      isCoord && h('fieldset', h('legend', 'فحص التسليم'),
        h('p.small', 'الترجمة: ', t.translation_html ? h('span.badge.ok', 'مرفقة') : h('span.badge.bad', 'غير موجودة')),
        m.deliverable === 'text_audio' && h('p.small', 'التسجيل الصوتي: ', t.audio_path ? h('span.badge.ok', 'مرفوع') : h('span.badge.bad', 'لم يُرفع')),
        h('label.check', checklist, 'تحققت من اكتمال الترجمة ومطابقتها للأصل')),
      h('label.field', 'ملاحظة', note),
      h('div.row',
        canEdit && h('button.btn', { type: 'button', onclick: e => busy(e.currentTarget, () => saveDraft().catch(err => toast(err.message, 'bad'))) }, 'حفظ المسودة'),
        h('button.btn.primary', { type: 'button', onclick: e => doComplete(e.currentTarget) },
          isMgr ? 'الاعتماد النهائي والنشر' : isCoord ? 'قبول الترجمة وإرسالها' : `إتمام ${stageName(cur.stage_key)} وإرسالها ←`),
        t.stages.some(s => s.sort < cur.sort) && h('button.btn', { type: 'button', onclick: doReturn }, 'إعادة للتعديل'),
        canEdit && saveState));
  } else if (t.status === 'completed') {
    actions = h('div.card', h('h3', 'اكتمل المسار'),
      h('p', t.is_published ? `منشورة على الموقع العام منذ ${fmtDateTime(t.published_at)}.` : 'مكتملة وغير منشورة.'),
      isManager() && h('button.btn', { onclick: e => busy(e.currentTarget, async () => {
        try { await db.rpc('set_published', { p_track: t.id, p_published: !t.is_published }); reload(); } catch (err) { toast(err.message, 'bad'); }
      }) }, t.is_published ? 'إخفاء من الموقع العام' : 'إعادة النشر'));
  } else {
    const who = t.status === 'awaiting_receipt' ? t.stages[0]?.assignee?.full_name : cur?.assignee?.full_name;
    actions = h('div.card', h('p', 'المهمة الآن لدى ', h('b', who || '—'), ' — ', statusBadge(t), '. تُعرض هنا للاطلاع.'));
  }

  const exportsBox = t.translation_html ? h('div.row',
    h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, () => downloadDocx(exportArgs).catch(err => toast(err.message, 'bad'))) }, 'تنزيل Word (.docx)'),
    h('button.btn.sm', { type: 'button', onclick: () => printTranslation(exportArgs) || toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad') }, 'طباعة / حفظ PDF')) : null;

  const lastReturn = [...events].reverse().find(e => e.action === 'returned');
  const returnedToMe = lastReturn && mine && lastReturn.target_stage_key === cur?.stage_key;

  return h('div',
    h('div.page-head.workspace-banner', h('div.grow',
      h('div.eyebrow', `${cur ? 'مهمة ' + stageName(cur.stage_key) : (t.status === 'completed' ? 'مهمة مكتملة' : 'بانتظار الاستلام')} · ${m.sermon_type || m.material_type}`),
      h('h1', `${langName(t.language_code)} — ${m.title}`),
      h('p.sub', `من العربية إلى ${langName(t.language_code)}`)),
      statusBadge(t), h('a.btn.sm', { href: '/app/tasks' }, 'مهامي')),
    returnedToMe && h('div.card', { style: { borderColor: 'var(--warn)', marginBottom: '16px' } },
      h('b', 'أُعيدت إليك للتعديل: '), lastReturn.note, h('span.small.muted', ` — ${lastReturn.actor?.full_name}، ${fmtDateTime(lastReturn.created_at)}`)),
    h('div.card', h('div.grid',
      ...[['العنوان', m.title], ['الموقع', MOSQUE[m.mosque]], ['الخطيب', m.khateeb?.name], ['التاريخ', m.sermon_date && fmtSermonDate(m.sermon_date)],
        ['اللغة', langName(t.language_code)], ['المطلوب', m.deliverable === 'text_audio' ? 'ترجمة نصية مع تسجيل صوتي' : 'ترجمة نصية'],
        ['الأهمية', PRIORITY[m.priority]], ['الوقت', trackTimer(t)]].filter(([, v]) => v).map(([k, v]) => h('div', h('div.small.muted', k), h('div', v))),
      h('div', h('div.small.muted', 'الإنجاز'), progressBar(t))),
      m.instructions && h('p', { style: { marginTop: '12px' } }, h('b', 'تعليمات الترجمة: '), m.instructions),
      lateSummary(t)),
    h('div.card', h('h3', 'المسار'), stageStrip(t)),
    actions,
    h('div.workspace', { style: { marginTop: '16px' } },
      h('div.card', h('h3', 'النص الأصلي — العربية'), sourceBox),
      h('div.card.stack', h('div.row', h('h3', { style: { flex: 1, margin: 0 } }, `الترجمة — ${langName(t.language_code)}`), exportsBox),
        editor.el,
        m.deliverable === 'text_audio' && h('fieldset', h('legend', 'التسجيل الصوتي'), audioBox))),
    h('details.card', { style: { marginTop: '16px' } }, h('summary', h('b', `سجل الإجراءات (${events.length})`)),
      h('ol', { style: { marginTop: '12px' } }, events.map(e => h('li', { style: { marginBottom: '6px' } },
        h('span.small.muted', fmtDateTime(e.created_at) + ' · '), h('b', e.actor?.full_name || '—'), ' · ',
        EVENT_LABEL[e.action] || e.action, e.stage_key ? ` · ${stageName(e.stage_key)}` : '',
        e.target_stage_key ? ` ← ${stageName(e.target_stage_key)}` : '', e.note ? h('div.small', '«' + e.note + '»') : null)))));
}
