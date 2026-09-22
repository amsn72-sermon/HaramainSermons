// مهامي، ومساحة عمل المهمة لكل الأدوار
import { h, fill, toast, busy, dialog, emptyState, fmtDateTime, fmtMinutes, fmtDuration } from '../ui.js';
import { db, storage, auth } from '../sb.js';
import { state, isManager, TRACK_SELECT, MOSQUE, PRIORITY, EVENT_LABEL, sortStages, currentStage,
  langName, langDir, stageName } from '../store.js';
import { statusBadge, trackTimer, progressBar, stageStrip, lateSummary } from './parts.js';
import { createEditor } from '../editor.js';
import { setSafeHtml } from '../sanitize.js';
import { downloadDocx, printTranslation } from '../export.js';
import { pdfViewer } from '../pdfview.js';
import { dataCard, letterheadPage, heading, fileName } from '../page.js';

const FULL = `${TRACK_SELECT},material:materials(*,khateeb:khateebs(name))`;
const myStages = t => t.stages.filter(s => s.assignee_id === state.profile.id);

function needsMe(t) {
  if (t.status === 'awaiting_receipt') return t.stages[0]?.assignee_id === state.profile.id;
  return currentStage(t)?.assignee_id === state.profile.id;
}

// هل بلغ المسار مرحلة التسجيل الصوتي؟
function audioOpen(t) {
  if (!t.audio_stage_key) return false;
  if (t.status === 'completed') return true;
  if (t.status === 'awaiting_receipt') return false;
  const cur = currentStage(t);
  const a = t.stages.find(s => s.stage_key === t.audio_stage_key);
  return !!(cur && a && cur.sort >= a.sort);
}

export function scoreBadge(score) {
  if (score == null) return h('span.badge', '—');
  const kind = score >= 100 ? 'ok' : score >= 80 ? 'gold' : score >= 60 ? 'warn' : 'bad';
  return h('span.badge', { class: kind, title: 'التقييم حسب الالتزام بالوقت المحدد' }, score >= 100 ? 'العلامة الكاملة 100' : `${score} / 100`);
}

// ---------------------------------------------------------------------
export async function list() {
  const [all, hist] = await Promise.all([
    db.select('tracks', { select: FULL, order: 'created_at.desc', limit: 300 }),
    db.rpc('my_history').catch(() => [])
  ]);
  const tracks = all.map(sortStages).filter(t => myStages(t).length);
  const now = tracks.filter(needsMe);
  const nowIds = new Set(now.map(t => t.id));
  const upcoming = (hist || []).filter(r => r.stage_status === 'waiting' && r.track_status !== 'completed' && !nowIds.has(r.track_id));
  const done = (hist || []).filter(r => r.stage_status === 'done');
  const scored = done.filter(r => r.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;

  const card = t => h('div.card', h('div.row',
    h('div', { style: { flex: 1, minWidth: '220px' } },
      h('b', `${t.material.title} — ${langName(t.language_code)}`),
      h('div.small.muted', [heading(t.material), t.material.priority !== 'normal' && PRIORITY[t.material.priority]].filter(Boolean).join(' · ')),
      h('div.small', 'دورك الآن: ', t.status === 'awaiting_receipt' ? 'استلام المهمة' : stageName(currentStage(t)?.stage_key)),
      lateSummary(t)),
    h('div', statusBadge(t), h('div', trackTimer(t))),
    h('div', { style: { minWidth: '140px' } }, progressBar(t)),
    h('a.btn.primary', { href: `/app/tasks/${t.id}` }, t.status === 'awaiting_receipt' ? 'استلام' : 'فتح والعمل')));

  const brief = r => [heading(r), langName(r.language_code), stageName(r.stage_key)].join(' · ');
  const upcomingRow = r => h('div.card', h('div.row',
    h('div', { style: { flex: 1 } }, h('b', r.title), h('div.small.muted', brief(r))),
    h('span.badge', 'بانتظار المراحل السابقة')));

  // السجل: البيانات الرئيسية والوقت المستغرق والتقييم فقط — المادة نفسها تُغلق بعد إتمام الدور
  const doneTable = h('div.table-wrap', h('table.responsive',
    h('thead', h('tr', ['#', 'المادة', 'اللغة والدور', 'الانتهاء', 'الوقت المستغرق', 'المحدد', 'التأخير', 'التقييم'].map(x => h('th', x)))),
    h('tbody', done.map((r, i) => h('tr',
      h('td', { 'data-label': '#' }, String(i + 1)),
      h('td', { 'data-label': 'المادة' }, h('b', r.title), h('span.sub', heading(r))),
      h('td', { 'data-label': 'اللغة والدور' }, langName(r.language_code), h('span.sub', stageName(r.stage_key))),
      h('td', { 'data-label': 'الانتهاء' }, fmtDateTime(r.finished_at)),
      h('td', { 'data-label': 'المستغرق' }, r.started_at && r.finished_at ? fmtDuration((new Date(r.finished_at) - new Date(r.started_at)) / 1000) : '—'),
      h('td', { 'data-label': 'المحدد' }, r.planned_minutes ? fmtMinutes(r.planned_minutes) : '—'),
      h('td', { 'data-label': 'التأخير' }, r.late_seconds > 0 ? h('span.badge.bad', fmtDuration(r.late_seconds)) : h('span.badge.ok', 'في الوقت')),
      h('td', { 'data-label': 'التقييم' }, scoreBadge(r.score)))))));

  const section = (title, count, content, emptyText) => h('section', { style: { marginBottom: '24px' } },
    h('h2', `${title} (${count})`), count ? content : h('p.muted', emptyText));

  const empty = !now.length && !upcoming.length && !done.length;
  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'مساحة العمل'), h('h1', 'مهامي')),
      avg != null && h('div', { style: { textAlign: 'center' } }, h('div.small.muted', 'متوسط تقييمك'), scoreBadge(avg))),
    empty ? emptyState('لا مهام مسندة إليك بعد', 'ستظهر هنا فور إسناد المنسق مادةً إليك.') : h('div',
      section('تحتاج إجراءً منك الآن', now.length, h('div.stack', now.map(card)), 'لا شيء بانتظارك حاليًا.'),
      section('قادمة', upcoming.length, h('div.stack', upcoming.map(upcomingRow)), 'لا مراحل قادمة مسندة إليك.'),
      section('سجل أعمالي', done.length, doneTable, 'لم تُتم أي مرحلة بعد.'),
      done.length ? h('p.small.muted', 'التقييم 100 عند الإنجاز ضمن الوقت المحدد، وينقص بقدر التأخير. بعد إتمام دورك تُغلق المادة ولا يبقى منها إلا هذا السجل.') : null));
}

// ---------------------------------------------------------------------
export async function workspace(ctx) {
  const [t] = await db.select('tracks', { select: FULL, id: `eq.${ctx.params.id}` });
  if (!t) return emptyState('المهمة غير متاحة', 'أُغلقت بعد إتمام دورك فيها، أو لم تعد مسندة إليك. يبقى إنجازك في سجل أعمالك.', h('a.btn', { href: '/app/tasks' }, 'مهامي'));
  sortStages(t);
  const m = t.material;
  const events = await db.select('track_events', { select: '*,actor:profiles(full_name)', track_id: `eq.${t.id}`, order: 'created_at.asc' });
  const cur = currentStage(t);
  const curDef = cur && state.stages.find(s => s.key === cur.stage_key);
  const me = state.profile.id;
  const mine = cur?.assignee_id === me && t.status !== 'awaiting_receipt' && t.status !== 'completed';
  const canAccept = t.status === 'awaiting_receipt' && t.stages[0]?.assignee_id === me;
  const canEdit = mine && curDef?.assignee_role === 'translator';
  const isCoord = mine && curDef?.assignee_role === 'coordinator';
  const isMgr = mine && curDef?.assignee_role === 'manager';
  const needsAudio = !!t.audio_stage_key;
  const audioNow = audioOpen(t);
  const audioStage = t.stages.find(s => s.stage_key === t.audio_stage_key);
  const dir = langDir(t.language_code);
  const reload = () => ctx.navigate(location.pathname, { replace: true });
  const exportArgs = { material: m, track: t, khateeb: m.khateeb?.name };

  // ----- الأصل العربي: صفحة بصفحة، بعلامة مائية، دون رابط أو تنزيل -----
  let sourceEl;
  if (m.source_pdf_path) {
    sourceEl = h('div', h('p.muted', 'جارٍ تحميل الأصل…'));
    storage.signedUrl('sources', m.source_pdf_path, 600).then(url => {
      const who = auth.user?.email || state.profile.full_name || '';
      sourceEl.replaceChildren(pdfViewer({ url, lines: [who, `سري — ${new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}`] }));
    }).catch(err => sourceEl.replaceChildren(h('p.err', err.message)));
  } else {
    const { page, body } = letterheadPage(dataCard(m, null, m.khateeb?.name), setSafeHtml(h('div.src', { dir: 'rtl', lang: 'ar' }), m.source_html || ''));
    page.classList.add('src-page');
    body.addEventListener('copy', e => e.preventDefault());
    sourceEl = page;
  }

  // ----- الترجمة: صفحة الكليشة بمساحة الكتابة الثابتة -----
  let dirty = false;
  const saveState = h('span.small.muted', t.translation_html ? 'محفوظة' : 'مسودة فارغة');
  const editor = createEditor({ html: t.translation_html || '', dir, readOnly: !canEdit, detachTools: true,
    label: `الترجمة (${langName(t.language_code)})`, top: dataCard(m, t.language_code, m.khateeb?.name),
    placeholder: canEdit ? 'اكتب الترجمة هنا…' : 'لم تُكتب الترجمة بعد.',
    onChange: () => { dirty = true; saveState.textContent = 'تعديلات غير محفوظة'; } });
  async function saveDraft(silent = false) {
    if (!canEdit || !dirty) return;
    await db.rpc('save_translation', { p_track: t.id, p_html: editor.html });
    t.translation_html = editor.html; dirty = false; saveState.textContent = 'محفوظة ' + fmtDateTime(new Date());
    if (!silent) toast('حُفظت المسودة.', 'ok');
  }
  const autosave = setInterval(() => { if (!editor.el.isConnected) return clearInterval(autosave); saveDraft(true).catch(() => {}); }, 60_000);
  window.onbeforeunload = () => (dirty ? true : undefined);

  // ----- التسجيل الصوتي -----
  let audioCard = null;
  if (needsAudio) {
    const box = h('div.stack', { style: { gap: '10px' } });
    const canUpload = mine && audioNow;
    const isReviewer = mine && cur.stage_key !== t.audio_stage_key && audioNow;
    const drawAudio = () => {
      const input = h('input', { type: 'file', accept: 'audio/*', 'aria-label': 'ملف التسجيل' });
      input.onchange = () => busy(input, async () => {
        const f = input.files[0];
        if (!f) return;
        if (!f.type.startsWith('audio/')) return toast('الملف ليس تسجيلًا صوتيًا.', 'bad');
        if (f.size > 200 * 1024 * 1024) return toast('الحد الأقصى ٢٠٠ ميغابايت.', 'bad');
        try {
          const ext = (f.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = await storage.upload('audio', `${t.id}/${crypto.randomUUID()}.${ext}`, f);
          await db.rpc('set_track_audio', { p_track: t.id, p_path: path });
          t.audio_path = path; drawAudio(); blockersBox.hidden = true; toast('رُفع التسجيل وحُفظ مع المهمة.', 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      });
      fill(box,
        !audioNow && h('p.small', `التسجيل مسند إلى مرحلة «${stageName(t.audio_stage_key)}» — ${audioStage?.assignee?.full_name || ''}.`),
        audioNow && (t.audio_path
          ? h('audio', { controls: true, preload: 'metadata', src: storage.publicUrl('audio', t.audio_path), style: { width: '100%' } })
          : h('p', h('span.badge.bad', 'مطلوب'), ' لم يُرفع التسجيل بعد، ولا يمكن إتمام المرحلة دونه.')),
        isReviewer && h('p.small', 'استمع إلى التسجيل كاملًا وتحقق من مطابقته للترجمة. إن عدّلت الترجمة فارفع تسجيلًا جديدًا مطابقًا، أو أعد المهمة إلى المترجم لإعادة التسجيل.'),
        canUpload && h('label.field', t.audio_path ? 'استبدال التسجيل بملف جديد' : 'رفع التسجيل (يُحفظ فور اختياره)', input));
    };
    drawAudio();
    audioCard = h('div.card.audio-card', { style: { marginTop: '16px' } }, h('h3', 'التسجيل الصوتي'), box);
  }

  // ----- الإجراءات (أسفل الصفحة) -----
  const note = h('textarea', { placeholder: 'ملاحظة للمرحلة التالية أو للمنسق (اختياري)', rows: 2 });
  const blockersBox = h('div.form-errors', { hidden: true, role: 'alert' });
  const nextStage = cur && t.stages.find(s => s.sort > cur.sort);

  function confirmItems() {
    if (isCoord) return [needsAudio ? 'تحققت من إتمام الترجمة والتسجيل الصوتي' : 'تحققت من إتمام الترجمة'];
    const items = [cur.stage_key === 'translation' ? 'راجعت الترجمة كاملة ومطابقتها للأصل' : 'راجعت الخطبة وترجمتها كاملة'];
    if (needsAudio && audioNow) items.push('راجعت التسجيل الصوتي واستمعت إليه');
    return items;
  }

  async function doComplete(btn) {
    await busy(btn, async () => {
      try {
        await saveDraft(true);
        const blockers = await db.rpc('stage_blockers', { p_track: t.id, p_checklist: true });
        if (blockers?.length) {
          blockersBox.replaceChildren(h('ul', blockers.map(b => h('li', b)))); blockersBox.hidden = false;
          blockersBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        blockersBox.hidden = true;
        const target = nextStage ? `${stageName(nextStage.stage_key)} — ${nextStage.assignee?.full_name}` : 'الاعتماد النهائي والنشر على الموقع العام';
        const boxes = confirmItems().map(text => ({ text, input: h('input', { type: 'checkbox' }) }));
        const err = h('p.err', { hidden: true }, 'أكّد جميع البنود قبل الإتمام.');
        const ok = await dialog({
          title: 'تأكيد الإتمام والإرسال',
          body: h('div.stack',
            h('div.check-list', boxes.map(b => h('label', b.input, b.text))),
            h('p.small', `تنتقل المهمة إلى: ${target}.`),
            !isMgr && h('p.small.muted', 'بعد التأكيد تُغلق المادة عنك ولا تظهر لك إلا إذا أُعيدت إليك، ويبقى إنجازك في سجل أعمالك.'),
            err),
          buttons: [
            { label: 'تأكيد الإتمام والإرسال', kind: 'primary', validate: () => { const all = boxes.every(b => b.input.checked); err.hidden = all; return all; }, value: true },
            { label: 'إلغاء', value: false }
          ]
        });
        if (!ok) return;
        await db.rpc('complete_stage', { p_track: t.id, p_checklist: true, p_note: note.value.trim() || null });
        window.onbeforeunload = null;
        toast(nextStage ? `انتقلت المهمة إلى ${stageName(nextStage.stage_key)}.` : 'اكتمل المسار ونُشرت الترجمة.', 'ok');
        ctx.navigate('/app/tasks');
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  async function doReturn() {
    const earlier = t.stages.filter(s => cur && s.sort < cur.sort);
    if (!earlier.length) return;
    const target = h('select', earlier.map(s => h('option', { value: s.stage_key }, `${stageName(s.stage_key)} — ${s.assignee?.full_name}`)));
    target.value = earlier[earlier.length - 1].stage_key;
    const reason = h('textarea', { rows: 4, placeholder: 'وضّح التعديلات المطلوبة (ومنها إعادة التسجيل الصوتي إن لزم)', required: true });
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
      toast(`أُعيدت المهمة إلى ${stageName(chosen.target)} مع سبب الإعادة.`, 'ok');
      ctx.navigate('/app/tasks');
    } catch (e) { toast(e.message, 'bad'); }
  }

  const exportsRow = t.translation_html ? h('div.row',
    h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, () => downloadDocx(exportArgs).catch(err => toast(err.message, 'bad'))) }, 'تنزيل Word على الكليشة'),
    h('button.btn.sm', { type: 'button', onclick: () => printTranslation(exportArgs) || toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad') }, 'طباعة / حفظ PDF')) : null;

  let actions;
  if (canAccept) {
    actions = h('div.card', h('h3', 'استلام المهمة'),
      h('p', 'بعد الاستلام يبدأ احتساب وقت الترجمة: ', h('b', fmtMinutes(t.stages[0]?.planned_minutes)), '. يُحدَّد موعد التسليم النهائي للمسار كله عند الاستلام، وتتوزع المدة على المراحل تلقائيًا.'),
      h('button.btn.primary', { onclick: e => busy(e.currentTarget, async () => {
        try { await db.rpc('accept_track', { p_track: t.id }); toast('تم تسجيل استلامك. يمكنك البدء.', 'ok'); reload(); }
        catch (err) { toast(err.message, 'bad'); }
      }) }, 'استلام المهمة وقبولها'));
  } else if (mine) {
    actions = h('div.card.stack',
      h('h3', `دورك: ${stageName(cur.stage_key)}`),
      blockersBox,
      isCoord && h('fieldset', h('legend', 'فحص التسليم'),
        h('p.small', 'تحقق من إتمام الترجمة والتسجيل الصوتي (لا يلزم معرفة اللغة).'),
        h('p.small', 'الترجمة: ', t.translation_html ? h('span.badge.ok', 'مكتوبة') : h('span.badge.bad', 'غير موجودة')),
        needsAudio && h('p.small', 'التسجيل الصوتي: ', t.audio_path ? h('span.badge.ok', 'مرفوع') : h('span.badge.bad', 'لم يُرفع'))),
      h('label.field', 'ملاحظة', note),
      h('div.row',
        canEdit && h('button.btn', { type: 'button', onclick: e => busy(e.currentTarget, () => saveDraft().catch(err => toast(err.message, 'bad'))) }, 'حفظ المسودة'),
        canEdit && saveState,
        h('span', { style: { flex: 1 } }),
        t.stages.some(s => s.sort < cur.sort) && h('button.btn', { type: 'button', onclick: doReturn }, 'إعادة للتعديل'),
        h('button.btn.primary', { type: 'button', onclick: e => doComplete(e.currentTarget) },
          isMgr ? 'الاعتماد النهائي والنشر' : isCoord ? 'قبول الترجمة وإرسالها' : `إتمام ${stageName(cur.stage_key)} وإرسالها ←`)),
      exportsRow);
  } else if (t.status === 'completed') {
    actions = h('div.card.stack', h('h3', 'اكتمل المسار'),
      h('p', t.is_published ? `منشورة على الموقع العام منذ ${fmtDateTime(t.published_at)}.` : 'مكتملة وغير منشورة.'),
      exportsRow,
      isManager() && h('div', h('button.btn', { onclick: e => busy(e.currentTarget, async () => {
        try { await db.rpc('set_published', { p_track: t.id, p_published: !t.is_published }); reload(); } catch (err) { toast(err.message, 'bad'); }
      }) }, t.is_published ? 'إخفاء من الموقع العام' : 'إعادة النشر')));
  } else {
    const who = t.status === 'awaiting_receipt' ? t.stages[0]?.assignee?.full_name : cur?.assignee?.full_name;
    actions = h('div.card.stack', h('p', 'المهمة الآن لدى ', h('b', who || '—'), ' — ', statusBadge(t), '. تُعرض هنا للاطلاع.'), exportsRow);
  }

  const lastReturn = [...events].reverse().find(e => e.action === 'returned');
  const returnedToMe = lastReturn && mine && lastReturn.target_stage_key === cur?.stage_key;
  document.title = fileName(m, t.language_code, m.khateeb?.name);

  return h('div',
    h('div.page-head.workspace-banner', h('div.grow',
      h('div.eyebrow', `${t.status === 'completed' ? 'مهمة مكتملة' : t.status === 'awaiting_receipt' ? 'بانتظار الاستلام' : 'مهمة ' + stageName(cur?.stage_key)} · ${heading(m)}`),
      h('h1', `${langName(t.language_code)} — ${m.title}`),
      h('p.sub', `من العربية إلى ${langName(t.language_code)}`)),
      statusBadge(t), h('div', trackTimer(t)), h('a.btn.sm', { href: '/app/tasks' }, 'مهامي')),
    returnedToMe && h('div.card', { style: { borderColor: 'var(--warn)', marginBottom: '16px' } },
      h('b', 'أُعيدت إليك للتعديل: '), lastReturn.note, h('span.small.muted', ` — ${lastReturn.actor?.full_name}، ${fmtDateTime(lastReturn.created_at)}`)),
    h('div.card',
      h('div.grid',
        ...[['الموقع', MOSQUE[m.mosque]], ['المطلوب', needsAudio ? `ترجمة وتسجيل صوتي (التسجيل: ${stageName(t.audio_stage_key)})` : 'ترجمة نصية'],
          ['الأهمية', PRIORITY[m.priority]], ['الإنجاز', progressBar(t)]].filter(([, v]) => v).map(([k, v]) => h('div', h('div.small.muted', k), h('div', v)))),
      m.instructions && h('p', { style: { marginTop: '12px' } }, h('b', 'تعليمات الترجمة: '), m.instructions),
      lateSummary(t)),
    h('details.card', h('summary', h('b', 'المسار والمراحل')), h('div', { style: { marginTop: '12px' } }, stageStrip(t))),
    h('div', { style: { marginTop: '16px' } },
      canEdit && h('div.ws-tools', editor.tools),
      h('div.workspace',
        h('div.ws-col', h('h3', 'النص الأصلي — العربية'), sourceEl),
        h('div.ws-col', h('h3', `الترجمة — ${langName(t.language_code)}`), editor.el))),
    audioCard,
    h('div', { style: { marginTop: '16px' } }, actions),
    h('details.card', { style: { marginTop: '16px' } }, h('summary', h('b', `سجل الإجراءات (${events.length})`)),
      h('ol', { style: { marginTop: '12px' } }, events.map(e => h('li', { style: { marginBottom: '6px' } },
        h('span.small.muted', fmtDateTime(e.created_at) + ' · '), h('b', e.actor?.full_name || '—'), ' · ',
        EVENT_LABEL[e.action] || e.action, e.stage_key ? ` · ${stageName(e.stage_key)}` : '',
        e.target_stage_key ? ` ← ${stageName(e.target_stage_key)}` : '', e.note ? h('div.small', '«' + e.note + '»') : null)))));
}
