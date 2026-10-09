// مهامي، ومساحة عمل المهمة لكل الأدوار
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDate, fmtDateTime, fmtMinutes, fmtDuration, digitalCountdown } from '../ui.js';
import { db, storage, auth } from '../sb.js';
import { state, isManager, isAdmin, TRACK_SELECT, MOSQUE_ANY, PRIORITY, EVENT_LABEL, sortStages, currentStage, langName, langDir, stageName, assigneeName } from '../store.js';
import { statusBadge, trackTimer, progressBar, stageStrip, lateSummary } from './parts.js';
import { createEditor } from '../editor.js';
import { audioInfo, specLine, isAllowedAudio, AUDIO_EXTS, SPEC } from '../audiofile.js';
import { downloadDocx, printTranslation } from '../export.js';
import { pdfViewer } from '../pdfview.js';
import { textViewer } from '../textview.js';
import { openRevision, revisionCard } from './revise.js';
import { dataCard, heading, fileName } from '../page.js';

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
  return h('span.badge', { class: kind, title: 'درجةُ الالتزام بالوقت المحدد — تُحسب آليًّا، وليست تقييمَ الهيئة' }, score >= 100 ? 'العلامة الكاملة 100' : `${score} / 100`);
}

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// مهامُّ ترجمةِ المصطلحات (ملاحظة ٢٦٠ ب)
//
//   جدولٌ بعمودين: المصطلحُ العربيُّ وخانةٌ يكتب فيها، ينتقل بينها
//   بـ Tab، ويُحفظ كلَّما كتب فلا يُلزَم بإتمامها في جلسة. وما يكتبه
//   يدخل الدليلَ معتمدًا بلا مراجعة.
// ---------------------------------------------------------------------
async function glossaryTaskDialog(task, onDone) {
  const body = h('div.stack', h('p.muted', 'يُحمَّل…'));
  const dlg = dialog({
    title: `ترجمةُ المصطلحات — ${task.language_name}`,
    body,
    buttons: [{ label: 'إغلاق', value: null }]
  });

  let rows = [];
  try { rows = await db.rpc('glossary_task_rows', { p_task: task.id }) || []; }
  catch (err) { body.replaceChildren(h('p.bad', err.message)); return dlg; }

  const progress = h('span.badge');
  const paint = () => {
    const done = rows.filter(r => r.term_tr).length;
    progress.textContent = `${done} / ${rows.length}`;
  };

  const save = async (r, input, mark) => {
    const text = input.value.trim();
    if (text === (r.term_tr || '')) return;
    try {
      await db.rpc('set_translation', { p_term: r.term_id, p_lang: task.language_code,
        p_text: text, p_why: null, p_task: task.id });
      r.term_tr = text;
      mark.textContent = text ? '✓' : '';
      mark.className = 'gl-save' + (text ? ' ok' : '');
      paint();
      if (onDone) onDone();
    } catch (err) { toast(err.message, 'bad'); mark.textContent = '✗'; mark.className = 'gl-save bad'; }
  };

  body.replaceChildren(
    h('div.row.between', h('span.small.muted', task.note || ''), progress),
    h('p.small.muted', 'يُحفظ ما تكتبه فور خروجك من الخانة — لا زرَّ حفظ، ولا يلزمك إتمامُها الآن.'),
    h('div.table-wrap.gl-task',
      h('table.responsive',
        h('thead', h('tr', h('th', 'المصطلح'), h('th', 'المقابل'), h('th', ''))),
        h('tbody', rows.map(r => {
          const input = h('input', { value: r.term_tr || '', dir: 'auto',
            'aria-label': `مقابل ${r.term_ar}` });
          const mark = h('span.gl-save' + (r.term_tr ? ' ok' : ''), r.term_tr ? '✓' : '');
          input.addEventListener('change', () => save(r, input, mark));
          input.addEventListener('blur', () => save(r, input, mark));
          return h('tr',
            h('td', { 'data-label': 'المصطلح' }, h('b', r.term_ar),
              r.explanation ? h('div.small.muted', r.explanation) : null),
            h('td', { 'data-label': 'المقابل' }, input),
            h('td', mark));
        })))));
  paint();
  return dlg;
}

export async function list() {
  const [all, hist, glTasks] = await Promise.all([
    db.select('tracks', { select: FULL, order: 'created_at.desc', limit: 300 }),
    db.rpc('my_history').catch(() => []),
    db.rpc('my_glossary_tasks').catch(() => [])
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

  // السجل: البيانات الرئيسية والوقت المستغرق ودرجة الالتزام — المادة نفسها تُغلق بعد إتمام الدور
  const doneTable = h('div.table-wrap', h('table.responsive',
    h('thead', h('tr', ['#', 'المادة', 'اللغة والدور', 'الانتهاء', 'الوقت المستغرق', 'المحدد', 'التأخير', 'الالتزام'].map(x => h('th', x)))),
    h('tbody', done.map((r, i) => h('tr',
      h('td', { 'data-label': '#' }, String(i + 1)),
      h('td', { 'data-label': 'المادة' }, h('b', r.title), h('span.sub', heading(r))),
      h('td', { 'data-label': 'اللغة والدور' }, langName(r.language_code), h('span.sub', stageName(r.stage_key))),
      h('td', { 'data-label': 'الانتهاء' }, fmtDateTime(r.finished_at)),
      h('td', { 'data-label': 'المستغرق' }, r.started_at && r.finished_at ? fmtDuration((new Date(r.finished_at) - new Date(r.started_at)) / 1000) : '—'),
      h('td', { 'data-label': 'المحدد' }, r.planned_minutes ? fmtMinutes(r.planned_minutes) : '—'),
      h('td', { 'data-label': 'التأخير' }, r.late_seconds > 0 ? h('span.badge.bad', fmtDuration(r.late_seconds)) : h('span.badge.ok', 'في الوقت')),
      h('td', { 'data-label': 'الالتزام' }, scoreBadge(r.score)))))));

  const section = (title, count, content, emptyText) => h('section', { style: { marginBottom: '24px' } },
    h('h2', `${title} (${count})`), count ? content : h('p.muted', emptyText));

  // بطاقةُ مهمّةِ المصطلحات
  const glCard = t => {
    const open = h('button.btn.primary', { type: 'button' },
      t.done >= t.total ? 'مراجعة' : 'ابدأ الترجمة');
    open.onclick = () => glossaryTaskDialog(t, () => { /* يُحدَّث العدُّ داخل النافذة */ });
    return h('div.card', h('div.row',
      h('div', { style: { flex: 1, minWidth: '220px' } },
        h('b', `${t.total} مصطلحًا تنتظر ترجمتك — ${t.language_name}`),
        t.note ? h('div.small.muted', t.note) : null,
        t.due_on ? h('div.small', 'الموعد: ', fmtDate(t.due_on)) : null),
      h('span.badge' + (t.done >= t.total ? '.ok' : ''), `${t.done} / ${t.total}`),
      open));
  };

  const empty = !now.length && !upcoming.length && !done.length && !(glTasks || []).length;
  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'مساحة العمل'), h('h1', 'مهامي')),
      avg != null && h('div', { style: { textAlign: 'center' } }, h('div.small.muted', 'متوسطُ التزامك بالمواعيد'), scoreBadge(avg))),
    empty ? emptyState('لا مهام مسندة إليك بعد', 'ستظهر هنا فور إسناد المنسق مادةً إليك.') : h('div',
      section('تحتاج إجراءً منك الآن', now.length, h('div.stack', now.map(card)), 'لا شيء بانتظارك حاليًا.'),
      (glTasks || []).length
        ? section('مصطلحاتٌ تنتظر ترجمتك', glTasks.length, h('div.stack', glTasks.map(glCard)), '')
        : null,
      section('قادمة', upcoming.length, h('div.stack', upcoming.map(upcomingRow)), 'لا مراحل قادمة مسندة إليك.'),
      section('سجل أعمالي', done.length, doneTable, 'لم تُتم أي مرحلة بعد.'),
      done.length ? h('p.small.muted', 'درجةُ الالتزام مئةٌ عند الإنجاز في وقته، وتنقص بقدر التأخير. وهي حسابُ مواعيدَ لا تقييمَ عمل. وتُغلَق المادةُ بعد إتمام دورِك.') : null));
}

// ---------------------------------------------------------------------
// مدة ملف صوتي بالثواني من المتصفح نفسه
function audioSeconds(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = v => { URL.revokeObjectURL(url); resolve(v); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration) : null);
    a.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذّر قراءة مدة التسجيل')); };
    setTimeout(() => done(null), 8000);
    a.src = url;
  });
}

export async function workspace(ctx) {
  const [t] = await db.select('tracks', { select: FULL, id: `eq.${ctx.params.id}` });
  if (!t) return emptyState('المهمة غير متاحة', 'أُغلقت بعد إتمام دورك فيها، أو لم تعد مسندة إليك. يبقى إنجازك في سجل أعمالك.', h('a.btn', { href: '/app/tasks' }, 'مهامي'));
  sortStages(t);
  const m = t.material;
  const events = await db.select('track_events', { select: '*,actor:profiles(full_name)', track_id: `eq.${t.id}`, order: 'created_at.asc' });
  const rev = await openRevision(m.id).catch(() => null);   // تعديل مطلوب على أصل الخطبة (ملاحظة ٢٨)
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
  if (m.source_audio_path) {
    // أصلٌ صوتي: يسمعه المترجم في مكان الأصل ويكتب ترجمته أمامه (ملاحظة ١٥٧)
    const player = h('audio', { controls: true, preload: 'metadata', style: { width: '100%' } });
    const info = h('span.small.muted', m.source_audio_seconds
      ? `مدة المقطع ${Math.floor(m.source_audio_seconds / 60)}:${String(m.source_audio_seconds % 60).padStart(2, '0')}`
      : 'جارٍ تحميل المقطع…');
    sourceEl = h('div.card.stack.src-audio',
      h('div.row.between', h('b', 'الأصل مقطعٌ صوتي'), h('span.badge.gold', 'نص صوتي')),
      player, info,
      h('p.small.muted', 'استمع إلى المقطع واكتب ترجمته في مساحة الترجمة. '
        + 'ويمكنك إبطاء التشغيل أو تسريعه من قائمة المشغّل عند الحاجة.'),
      m.instructions ? h('p.small', h('b', 'تعليمات المنسق: '), m.instructions) : null);
    storage.signedUrl('sources', m.source_audio_path, 3600)
      .then(url => { player.src = url; })
      .catch(err => info.replaceChildren(h('span.small.bad', err.message)));
    // مدة المقطع تُقاس أول مرة يُشغَّل فيها، فتُحفظ للمرات القادمة
    player.onloadedmetadata = () => {
      const sec = Math.round(player.duration || 0);
      if (!sec || !Number.isFinite(sec)) return;
      info.textContent = `مدة المقطع ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      if (!m.source_audio_seconds) {
        db.rpc('set_source_audio_seconds', { p_material: m.id, p_seconds: sec }).catch(() => {});
      }
    };
  } else if (m.source_pdf_path) {
    sourceEl = h('div', h('p.muted', 'جارٍ تحميل الأصل…'));
    storage.signedUrl('sources', m.source_pdf_path, 600).then(url => {
      const who = auth.user?.email || state.profile.full_name || '';
      sourceEl.replaceChildren(pdfViewer({ url, lines: [who, `سري — ${new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}`],
        marks: rev?.marks || [] }));
    }).catch(err => sourceEl.replaceChildren(h('p.err', err.message)));
  } else {
    // الأصل المكتوب نصًّا: على الكليشة صفحةً صفحة كملف PDF، بعلامة مائية (ملاحظة ١٠٢)
    const who = auth.user?.email || state.profile.full_name || '';
    sourceEl = textViewer({ html: m.source_html || '', lines: [who], dir: 'rtl', lang: 'ar' });
  }

  // ----- الترجمة: صفحة الكليشة بمساحة الكتابة الثابتة -----
  let dirty = false;
  const saveState = h('span.small.muted', t.translation_html ? 'محفوظة' : 'مسودة فارغة');
  const editor = createEditor({ html: t.translation_html || '', dir, readOnly: !canEdit, detachTools: true,
    label: `الترجمة (${langName(t.language_code)})`, top: dataCard(m, t.language_code, m.khateeb?.name),
    placeholder: canEdit ? 'اكتب الترجمة هنا…' : 'لم تُكتب الترجمة بعد.',
    onChange: () => { dirty = true; saveState.textContent = 'تعديلات غير محفوظة'; onEdit(); } });
  // نسخة محلية فورية في المتصفح: لو توقف الحاسوب فجأة لا يضيع ما كُتب (ملاحظة ٣٦)
  const LOCAL = `hs.draft.${t.id}`;
  const keepLocal = () => { try { localStorage.setItem(LOCAL, JSON.stringify({ html: editor.html, at: Date.now() })); } catch { /* التخزين ممتلئ أو محظور */ } };
  const dropLocal = () => { try { localStorage.removeItem(LOCAL); } catch { /* */ } };

  async function saveDraft(silent = false) {
    if (!canEdit || !dirty) return;
    await db.rpc('save_translation', { p_track: t.id, p_html: editor.html });
    t.translation_html = editor.html; dirty = false;
    dropLocal();
    saveState.textContent = 'محفوظة ' + fmtDateTime(new Date());
    saveBtn && saveBtn.classList.remove('primary');
    if (!silent) toast('حُفظت الترجمة.', 'ok');
  }
  // زر حفظ ثابت مع أدوات المحرر: يبقى أمام المترجم وهو ينظر إلى ملف الأصل
  const saveBtn = canEdit ? h('button.btn.sm', { type: 'button', title: 'حفظ الآن (Ctrl/⌘ + S)' },
    'حفظ الترجمة') : null;
  if (saveBtn) saveBtn.onclick = e => busy(e.currentTarget, () => saveDraft().catch(err => toast(err.message, 'bad')));
  // الدليل المصطلحي في متناول اليد: يُفتح فوق العمل ولا يغادره المترجم (ملاحظة ١٥٠)
  const glossarySlot = h('div.row.ws-glossary');
  const glBtn = h('button.btn.sm', { type: 'button', title: 'الرجوع إليه إلزامي عند لبس المصطلح' }, '📖 الدليل الإرشادي');
  glBtn.onclick = () => import('./glossary.js').then(m => m.glossaryPanel()).catch(err => toast(err.message, 'bad'));
  if (editor.tools) editor.tools.append(glBtn);
  else glossarySlot.append(glBtn);
  // عدّادُ الفقرات: يرى المترجمُ الخللَ وهو يكتب لا بعد شهر (ملاحظة ٢٥٢)
  //   فالتصديرُ المقابِل يحاذي بالترتيب، واختلافُ العدد يُزيح ما بعده.
  const parCount = h('span.small.par-count', { title: 'عددُ فقرات الأصل وفقرات ترجمتك — '
    + 'تساويهما يجعل التصديرَ المقابل مستقيمًا' });
  let countParas = null;
  const paintParas = async () => {
    try {
      if (!countParas) ({ toParagraphs: countParas } = await import('../aligned.js'));
      const a = countParas(m.source_html || '').length;
      const b = countParas(editor.html || '').length;
      if (!a) { parCount.textContent = ''; return; }
      parCount.textContent = `الأصل ${a} فقرة · ترجمتُك ${b}`;
      parCount.className = 'small par-count' + (b === 0 ? '' : (a === b ? ' ok' : ' warn'));
      parCount.title = a === b ? 'متساويتان — التصديرُ المقابل يستقيم'
        : 'اختلفَ العدد: لا تدمج فقرتين ولا تقسم فقرة، والسطرُ الفارغُ الزائدُ يصنع فقرةً وهمية';
    } catch { parCount.textContent = ''; }
  };

  // الحفظ داخل شريط الأدوات لا خارجه، فيبقى الشريط كاملًا أمام المترجم (ملاحظة ٦٨)
  if (canEdit) editor.tools.append(h('span.tb-save', parCount, saveState, saveBtn));

  // حفظ تلقائي كل ٢٠ ثانية، وبعد ٤ ثوانٍ من توقف الكتابة، ونسخة محلية عند كل تعديل
  let idle = null;
  const onEdit = () => {
    keepLocal();
    paintParas();
    saveBtn && saveBtn.classList.add('primary');
    clearTimeout(idle);
    idle = setTimeout(() => saveDraft(true).catch(() => {}), 4000);
  };
  paintParas();
  const autosave = setInterval(() => { if (!editor.el.isConnected) return clearInterval(autosave); saveDraft(true).catch(() => {}); }, 20_000);
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); if (canEdit) saveDraft().catch(err => toast(err.message, 'bad'));
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(true).catch(() => {}); });
  window.onbeforeunload = () => (dirty ? true : undefined);

  // استرجاع نسخة محلية أحدث من المحفوظة على الخادم (انقطاع مفاجئ)
  if (canEdit) {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL) || 'null');
      if (saved?.html && saved.html !== (t.translation_html || '')) {
        setTimeout(async () => {
          const ok = await confirm('استعادة نسخة غير محفوظة',
            `وُجدت نسخة محفوظة في هذا المتصفح (${fmtDateTime(new Date(saved.at))}) لم تصل إلى الخادم. هل نستعيدها؟`, 'استعادة');
          if (ok) { editor.html = saved.html; dirty = true; saveState.textContent = 'تعديلات غير محفوظة'; }
          else dropLocal();
        }, 400);
      }
    } catch { /* لا نسخة محلية */ }
  }

  // ----- التسجيل الصوتي: نسخ متعددة يعتمد المدير منها ما يشاء -----
  let audioCard = null;
  if (needsAudio) {
    const box = h('div.stack', { style: { gap: '10px' } });
    const canUpload = mine && audioNow;
    const isReviewer = mine && cur.stage_key !== t.audio_stage_key && audioNow;
    const canApprove = isManager() && t.status !== 'awaiting_receipt';
    let takes = [];
    const loadTakes = async () => {
      try { takes = await db.select('track_audios', { select: '*,by:profiles(full_name)', track_id: `eq.${t.id}`, order: 'created_at.asc' }); }
      catch { takes = []; }
    };
    const picks = new Set();
    const specs = new Map();          // path -> مواصفات مقيسة عند الرفع
    const audioErr = h('div.err-box', { hidden: true, role: 'alert' });
    const drawAudio = () => {
      const input = h('input', { type: 'file', accept: '.wav,.mp3,audio/wav,audio/x-wav,audio/mpeg',
        'aria-label': 'ملف التسجيل' });
      input.onchange = () => busy(input, async () => {
        const f = input.files[0];
        if (!f) return;
        audioErr.hidden = true;
        const fail = (title, lines) => {
          audioErr.replaceChildren(h('b', title), h('ul', lines.map(x => h('li', x))));
          audioErr.hidden = false;
          audioErr.scrollIntoView({ block: 'center' });
          input.value = '';
        };
        // الصيغة شرطٌ في العقد، والفيديو يُرفض (ملاحظة ١٤٣)
        if (!isAllowedAudio(f)) {
          return fail('لم يُرفع التسجيل — الصيغة غير معتمدة',
            [`الصيغ المعتمدة في العقد: ${AUDIO_EXTS.map(x => x.toUpperCase()).join(' أو ')} فقط.`,
             'حوِّل الملف إلى إحداهما، أو سجّل ببرنامج يخرجها — وفي «دليل التسجيل الصوتي» برامج مقترحة.']);
        }
        if (f.size > 200 * 1024 * 1024) return fail('الملف أكبر من الحد', ['الحد الأقصى 200 ميغابايت.']);

        let info = null;
        try { info = await audioInfo(f); } catch { info = null; }
        if (info?.video) {
          return fail('هذا مقطع فيديو',
            ['ارفع تسجيلًا صوتيًّا فقط (WAV أو MP3) حفظًا لمساحة الخادم.']);
        }
        try {
          const ext = (f.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
          // مدة التسجيل تُقاس هنا لتُحسب الدقائق في دليل الإنتاج (ملاحظة ٩٠)
          const seconds = Math.round(info?.duration || 0) || await audioSeconds(f).catch(() => null);
          const path = await storage.upload('audio', `${t.id}/${crypto.randomUUID()}.${ext}`, f);
          await db.rpc('set_track_audio', { p_track: t.id, p_path: path, p_seconds: seconds });
          if (info) specs.set(path, info);
          t.audio_path = path; await loadTakes(); drawAudio(); blockersBox.hidden = true;
          toast(info?.issues?.length
            ? 'رُفع التسجيل، وعليه ملاحظات في الجودة يراها المنسق.'
            : 'أُضيف تسجيل جديد، والسابق محفوظ.', info?.issues?.length ? 'warn' : 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      });

      const row = (a, i) => h('div.take', { class: a.is_approved ? 'ok' : '' },
        h('div.row', { style: { gap: '8px', alignItems: 'center' } },
          canApprove && h('input', { type: 'checkbox', checked: picks.has(a.id), 'aria-label': `اعتماد التسجيل ${i + 1}`,
            onchange: e => { e.target.checked ? picks.add(a.id) : picks.delete(a.id); } }),
          h('b', `التسجيل ${i + 1}`),
          h('span.small.muted', `${a.by?.full_name || '—'} · ${stageName(a.stage_key) || ''} · ${fmtDateTime(a.created_at)}`),
          a.is_approved && h('span.badge.ok', 'معتمد')),
        h('audio', { controls: true, preload: 'none', src: storage.publicUrl('audio', a.path), style: { width: '100%' } }),
        (() => {
          // مواصفات التسجيل تُعرض للمنسق ليقبل أو يُعيد — ولا تحجب الرفع (ملاحظة ١٤٣)
          const info = specs.get(a.path);
          const ext = (a.path.split('.').pop() || '').toUpperCase();
          if (!info) return h('span.small.muted', `${ext}${a.duration_seconds ? ` · ${Math.round(a.duration_seconds / 60)} دقيقة` : ''}`);
          return h('div.stack', { style: { gap: '2px' } },
            h('span.small.muted', specLine(info)),
            info.issues.length
              ? h('span.small.warn', '⚠ ' + info.issues.join(' · '))
              : h('span.small.ok', '✓ مطابق لمواصفات العقد'));
        })());

      const needNew = t.audio_required_after && !takes.some(a => new Date(a.created_at) > new Date(t.audio_required_after));
      fill(box,
        needNew && h('p', h('span.badge.bad', 'إعادة التسجيل'), ' التعديل على أصل الخطبة يستوجب تسجيلًا صوتيًا جديدًا؛ التسجيلات السابقة محفوظة.'),
        !audioNow && h('p.small', `التسجيل مسند إلى مرحلة «${stageName(t.audio_stage_key)}» — ${assigneeName(audioStage?.assignee)}.`),
        audioNow && !takes.length && h('p', h('span.badge.bad', 'مطلوب'), ' لم يُرفع التسجيل بعد، ولا يمكن إتمام المرحلة دونه.'),
        takes.map(row),
        isReviewer && h('p.small', 'استمع إلى التسجيل كاملًا وتحقق من مطابقته للترجمة. إن عدّلت الترجمة فارفع تسجيلًا جديدًا (يُحفظ السابق باسم صاحبه)، أو أعد المهمة إلى المترجم.'),
        canUpload && audioErr,
        canUpload && h('div.spec-note',
          h('b', 'الصيغ المعتمدة: '), `${AUDIO_EXTS.map(x => x.toUpperCase()).join(' أو ')}`,
          h('span', ` — بجودة ${SPEC.kbps} kbps فأعلى، ومعدل عينة ${SPEC.sampleRate / 1000} kHz فأعلى، `),
          h('span', 'صوتٌ واضح بلا تشويش ولا مؤثرات، وبلا صمتٍ طويل في أوله وآخره.'),
          h('a', { href: '/app/audio-guide' }, 'دليل التسجيل الصوتي ←')),
        canUpload && h('label.field', takes.length ? 'إضافة تسجيل جديد (تبقى النسخ السابقة)' : 'رفع التسجيل (يُحفظ فور اختياره)', input),
        canApprove && takes.length > 1 && h('p.small.muted', 'اختر التسجيل الأفضل أداءً وجودة، ويمكن اعتماد أكثر من تسجيل.'),
        canApprove && takes.length ? h('div.row',
          h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
            if (!picks.size) return toast('أشّر على تسجيل واحد على الأقل.', 'bad');
            try {
              await db.rpc('approve_track_audios', { p_track: t.id, p_ids: [...picks] });
              await loadTakes(); drawAudio(); toast('اعتُمد التسجيل المختار.', 'ok');
            } catch (err) { toast(err.message, 'bad'); }
          }) }, 'اعتماد التسجيل المختار')) : null);
    };
    audioCard = h('div.card.audio-card', { style: { marginTop: '16px' } }, h('h3', 'التسجيل الصوتي'), box);
    loadTakes().then(() => { takes.filter(a => a.is_approved).forEach(a => picks.add(a.id)); drawAudio(); });
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
        const target = nextStage ? `${stageName(nextStage.stage_key)} — ${assigneeName(nextStage.assignee)}` : 'الاعتماد النهائي والنشر على الموقع العام';
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
    const target = h('select', earlier.map(s => h('option', { value: s.stage_key }, `${stageName(s.stage_key)} — ${assigneeName(s.assignee)}`)));
    target.value = earlier[earlier.length - 1].stage_key;
    const reason = h('textarea', { rows: 4, placeholder: 'وضّح التعديلات المطلوبة (ومنها إعادة التسجيل الصوتي إن لزم)', required: true });
    const err = h('p.err', { hidden: true }, 'اكتب سبب الإعادة (3 أحرف على الأقل).');
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

  // التصدير والطباعة للمنسق ومدير المشروع فقط (ملاحظة ١٧)
  const exportsRow = isAdmin() && t.translation_html ? h('div.row',
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
    const who = t.status === 'awaiting_receipt' ? assigneeName(t.stages[0]?.assignee) : assigneeName(cur?.assignee);
    actions = h('div.card.stack', h('p', 'المهمة الآن لدى ', h('b', who || '—'), ' — ', statusBadge(t), '. تُعرض هنا للاطلاع.'), exportsRow);
  }

  const lastReturn = [...events].reverse().find(e => e.action === 'returned');
  const returnedToMe = lastReturn && mine && lastReturn.target_stage_key === cur?.stage_key;
  // العد التنازلي كساعة رقمية كبيرة: أخضر ثم أحمر عند التجاوز (ملاحظة ٦٧)
  const workspaceClock = tr => {
    if (tr.status === 'completed') return h('div.digital-clock.done', h('span.dc-time', '—'), h('span.dc-note', 'اكتملت'));
    if (tr.status === 'awaiting_receipt') return digitalCountdown(tr.receipt_due_at);
    const c = currentStage(tr);
    if (!c) return null;
    if (c.outside_sla) return h('div.digital-clock.off', h('span.dc-time', '—'), h('span.dc-note', 'خارج وقت التنفيذ'));
    return digitalCountdown(c.due_at);
  };

  document.title = fileName(m, t.language_code, m.khateeb?.name, null, t.doc_no);

  // في الجوال: تبويبان بدل عمودين متلاصقين، فالشاشة ضيّقة (ملاحظة ١١١)
  function wsBlock() {
    const srcCol = h('div.ws-col', { 'data-pane': 'src' },
      h('h3', m.source_audio_path ? 'الأصل الصوتي — العربية' : 'النص الأصلي — العربية'), sourceEl);
    const trCol = h('div.ws-col', { 'data-pane': 'tr' }, h('h3', `الترجمة — ${langName(t.language_code)}`), editor.el);
    const grid = h('div.workspace', srcCol, trCol);
    const tabSrc = h('button.btn.tab', { type: 'button', role: 'tab' }, 'النص الأصلي');
    const tabTr = h('button.btn.tab.on', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'الترجمة');
    const tabs = h('div.tabs.ws-tabs', { role: 'tablist' }, tabSrc, tabTr);
    const wrap = h('div.ws-wrap', { style: { marginTop: '16px' } },
      tabs, canEdit && h('div.ws-tools', editor.tools), glossarySlot, grid);
    const pick = pane => {
      grid.dataset.pane = pane; wrap.dataset.pane = pane;
      tabSrc.classList.toggle('on', pane === 'src'); tabTr.classList.toggle('on', pane === 'tr');
      tabSrc.setAttribute('aria-selected', String(pane === 'src'));
      tabTr.setAttribute('aria-selected', String(pane === 'tr'));
    };
    tabSrc.onclick = () => pick('src');
    tabTr.onclick = () => pick('tr');
    pick(canEdit ? 'tr' : 'src');
    return wrap;
  }

  return h('div',
    h('div.page-head.workspace-banner', h('div.grow',
      h('div.eyebrow', `${t.status === 'completed' ? 'مهمة مكتملة' : t.status === 'awaiting_receipt' ? 'بانتظار الاستلام' : 'مهمة ' + stageName(cur?.stage_key)} · ${heading(m)}`),
      h('h1', `${langName(t.language_code)} — ${m.title}`),
      h('p.sub', `من العربية إلى ${langName(t.language_code)}`)),
      // رقم التوثيق يُمنح عند الاعتماد فيظهر هنا وعلى مخرجات العمل (ملاحظة ١٤٥)
      t.doc_no ? h('span.doc-no', { dir: 'ltr', title: 'رقم التوثيق' }, t.doc_no) : null,
      statusBadge(t), h('a.btn.sm', { href: '/app/tasks' }, 'مهامي'), workspaceClock(t)),
    returnedToMe && h('div.card', { style: { borderColor: 'var(--warn)', marginBottom: '16px' } },
      h('b', 'أُعيدت إليك للتعديل: '), lastReturn.note, h('span.small.muted', ` — ${lastReturn.actor?.full_name}، ${fmtDateTime(lastReturn.created_at)}`)),
    h('div.card',
      h('div.grid',
        ...[['الموقع', MOSQUE_ANY[m.mosque] || '—'], ['المطلوب', needsAudio ? `ترجمة وتسجيل صوتي (التسجيل: ${stageName(t.audio_stage_key)})` : 'ترجمة نصية'],
          ['الأهمية', PRIORITY[m.priority]], ['الإنجاز', progressBar(t)]].filter(([, v]) => v).map(([k, v]) => h('div', h('div.small.muted', k), h('div', v)))),
      m.instructions && h('p', { style: { marginTop: '12px' } }, h('b', 'تعليمات الترجمة: '), m.instructions),
      lateSummary(t)),
    rev ? h('div', { style: { marginTop: '16px' } }, revisionCard(rev)) : null,
    h('details.card', h('summary', h('b', 'المسار والمراحل')), h('div', { style: { marginTop: '12px' } }, stageStrip(t))),
    wsBlock(),
    audioCard,
    h('div', { style: { marginTop: '16px' } }, actions),
    h('details.card', { style: { marginTop: '16px' } }, h('summary', h('b', `سجل الإجراءات (${events.length})`)),
      h('ol', { style: { marginTop: '12px' } }, events.map(e => h('li', { style: { marginBottom: '6px' } },
        h('span.small.muted', fmtDateTime(e.created_at) + ' · '), h('b', e.actor?.full_name || '—'), ' · ',
        EVENT_LABEL[e.action] || e.action, e.stage_key ? ` · ${stageName(e.stage_key)}` : '',
        e.target_stage_key ? ` ← ${stageName(e.target_stage_key)}` : '', e.note ? h('div.small', '«' + e.note + '»') : null)))));
}
