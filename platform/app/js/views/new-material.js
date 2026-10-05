// إضافة مادة وإسنادها — على ثلاث خطوات مع حفظ مسودة محلية
import { h, fill, toast, busy, fmtMinutes, confirm, req, markBad } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager, can, MATERIAL_TYPES, SERMON_TYPES, MOSQUE, PRIORITY, langName, stageName, needsMosque, GENERAL_MOSQUE } from '../store.js';
import { createEditor } from '../editor.js';
import { plainText } from '../sanitize.js';
import { AUDIO_EXTS, isAllowedAudio, audioInfo, specLine } from '../audiofile.js';

const DRAFT = 'hs.material-draft';
// ٣. المدة الكلية تُحدَّد تلقائيًا حسب الأهمية (بالأيام)، وتبقى قابلة للتعديل
const PRIORITY_DAYS = { emergency: 1, urgent: 2, normal: 3 };

export async function render(ctx) {
  // الاقتراحُ يُجلب مع الأعضاء قبل الرسم، فلا يصل متأخّرًا بعد اختيار
  // المنسّق فيُزيحه (ملاحظة ٢٥٠)
  const sugOf = new Map();   // «lang|stage» ← معرّفُ العضو
  const [everyone, sugRows] = await Promise.all([
    db.select('profiles', {
      select: 'id,full_name,role,track,may_translate,native_lang,member_languages(language_code,assignable,default_stage,priority)',
      status: 'eq.active', order: 'full_name.asc'
    }),
    db.rpc('suggest_assignees_all').catch(() => [])
  ]);
  for (const r of (Array.isArray(sugRows) ? sugRows : [])) {
    sugOf.set(`${r.language_code}|${r.stage_key}`, r.member_id);
  }
  // فريق الإرشاد المكاني لا تُسنَد إليه أعمال ترجمة (ملاحظة ٩٩)
  // فريق الإرشاد المكاني لا تُسنَد إليه ترجمة، إلا المتميّز فبلغته (ملاحظة ١٧٣)
  // ولا يظهر في الإسناد إلا من حُدِّد له «يترجم» (ملاحظة ٢٠٦)
  const members = everyone.filter(m => m.may_translate);
  const langsOf = m => new Set((m.member_languages || []).map(x => x.language_code));
  // لا يُسنَد إلا في لغةٍ اعتمدتها الإدارة (ملاحظة ٢٤٩)
  const assignOf = m => new Set((m.member_languages || [])
    .filter(x => x.assignable !== false).map(x => x.language_code));
  const activeStages = state.stages.filter(s => s.is_active);
  const slaStages = activeStages.filter(s => !s.outside_sla);

  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch { /* */ }

  // ---------------- الخطوة ١: بيانات المادة ----------------
  const f = {
    // الاختيار صريح لا افتراضي، فلا تمرّ مادة بنوع لم يقصده المنسق (ملاحظة ١٤٢)
    material_type: h('select', h('option', { value: '' }, '— اختر نوع المادة —'),
      MATERIAL_TYPES.map(t => h('option', t))),
    sermon_type: h('select', h('option', { value: '' }, '— اختر نوع الخطبة —'),
      SERMON_TYPES.map(t => h('option', t))),
    title: h('input', { placeholder: 'عنوان المادة', maxlength: 300 }),
    mosque: h('select', Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v))),
    khateeb_id: h('select'),
    sermon_date: h('input', { type: 'date' }),
    author: h('input'),
    instructions: h('textarea', { placeholder: 'السياق، متطلبات الصياغة، وطريقة الاستخدام' }),
    source_mode: h('select', h('option', { value: 'text' }, 'إدخال النص مباشرة'),
      h('option', { value: 'pdf' }, 'إرفاق ملف PDF عربي'),
      h('option', { value: 'audio' }, 'رفع مقطع صوتي عربي (نص صوتي)')),
    pdf: h('input', { type: 'file', accept: 'application/pdf' }),
    audio: h('input', { type: 'file', accept: '.wav,.mp3,audio/wav,audio/x-wav,audio/mpeg',
      'aria-label': 'المقطع الصوتي العربي' }),
    deliverable: h('select', h('option', { value: 'text_audio' }, 'ترجمة كتابية مع تسجيل صوتي'), h('option', { value: 'text' }, 'ترجمة كتابية فقط')),
    priority: h('select', Object.entries(PRIORITY).map(([k, v]) => h('option', { value: k }, v))),
    total: h('input', { type: 'number', min: 1, value: PRIORITY_DAYS.normal }),
    unit: h('select', h('option', { value: '60' }, 'ساعات'), h('option', { value: '1440', selected: true }, 'أيام')),
    receipt: h('input', { type: 'number', min: 5, value: 120 }),
    reminder: h('select', [5, 15, 30, 60].map(n => h('option', { value: n, selected: n === 15 }, fmtMinutes(n)))),
    escalate: h('input', { type: 'checkbox' })
  };
  // الأصل المكتوب يُحرَّر على ورقة الكليشة نفسها، فيرى المنسق ما سيصل المترجم (ملاحظة ١٠٨)
  const source = createEditor({ label: 'النص العربي', dir: 'rtl', detachTools: true,
    placeholder: 'اكتب النص العربي أو الصقه هنا… ويظهر على الكليشة كما سيصل المترجم',
    html: draft.source_html || '' });
  for (const [k, el] of Object.entries(f)) if (draft[k] !== undefined && el.type !== 'file') el.type === 'checkbox' ? (el.checked = draft[k]) : (el.value = draft[k]);

  function fillKhateebs() {
    const keep = f.khateeb_id.value;
    fill(f.khateeb_id, h('option', { value: '' }, '— اختر —'),
      state.khateebs.filter(k => k.mosque === f.mosque.value && k.is_active).map(k => h('option', { value: k.id }, k.name)));
    f.khateeb_id.value = keep;
  }
  fillKhateebs(); if (draft.khateeb_id) f.khateeb_id.value = draft.khateeb_id;
  f.mosque.addEventListener('change', fillKhateebs);

  const sermonOnly = h('div.grid-2',
    h('label.field', req('نوع الخطبة'), f.sermon_type),
    h('label.field', req('الخطيب'), f.khateeb_id));
  // الخطب والدروس تتبع مسجدًا؛ الكتب والمطويات والإعلانات والتوجيهات عامة (ملاحظة ٦٩)
  const mosqueWrap = h('label.field', req('مكان الخطبة / الموقع'), f.mosque);
  const pdfWrap = h('label.field', req('ملف الأصل العربي (PDF)'), h('small', 'حتى ٢٠ ميغابايت'), f.pdf);

  // كلمات الأصل العربي: عليها يُحتسب العمل في العقد، تُحصى آليًّا ويصحّحها
  // المنسق إن أخطأت الآلة (ملاحظة ١٨٨)
  let autoWords = null;
  const wordsIn = h('input', { type: 'number', min: 0, max: 5000000,
    'aria-label': 'كلمات الأصل العربي', placeholder: 'تُحصى آليًّا' });
  const wordsNote = h('div.small.muted');
  const wordsBtn = h('button.btn.xs', { type: 'button' }, 'أحصِ الكلمات');
  const setWords = (n, note, kind = 'muted') => {
    autoWords = n;
    wordsIn.value = n == null ? '' : String(n);
    wordsNote.className = `small ${kind}`;
    wordsNote.textContent = note || '';
  };
  const countNow = async () => {
    if (f.source_mode.value === 'text') {
      const txt = (source.html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim();
      const n = txt ? txt.split(' ').filter(Boolean).length : 0;
      setWords(n, n ? `أُحصيت ${n.toLocaleString('en-US')} كلمة من النص المكتوب.`
        : 'لا نصّ بعد — اكتب الأصل العربي ثم أعد الإحصاء.', n ? 'ok' : 'warn');
      return;
    }
    if (f.source_mode.value === 'pdf') {
      const file = f.pdf.files[0];
      if (!file) return setWords(null, 'أرفق ملف PDF أولًا.', 'warn');
      setWords(null, 'جارٍ قراءة الملف…');
      try {
        const { pdfWordCount } = await import('../pdfview.js');
        const r = await pdfWordCount(file);
        if (r.scanned) {
          setWords(null, `الملف ${r.pages} صفحة ممسوحة صورةً بلا نصّ — اكتب العدد بنفسك.`, 'warn');
        } else {
          setWords(r.words, `أُحصيت ${r.words.toLocaleString('en-US')} كلمة من ${r.pages} صفحة. `
            + 'راجعها وصحّحها إن أخطأت.', 'ok');
        }
      } catch (e) {
        setWords(null, `تعذّرت قراءة الملف: ${e.message} — اكتب العدد بنفسك.`, 'warn');
      }
      return;
    }
    setWords(null, 'المادة الصوتية لا كلمات أصلٍ مكتوبة لها — اتركه فارغًا أو اكتبه بعد النسخ.', 'muted');
  };
  wordsBtn.onclick = () => busy(wordsBtn, countNow);
  f.pdf.addEventListener('change', () => { if (f.source_mode.value === 'pdf') countNow(); });

  const wordsWrap = h('div.card.stack.words-card',
    h('div.row.between', h('b', 'كلمات الأصل العربي'), wordsBtn),
    h('p.small.muted', 'عليها يُحتسب العمل في العقد، وتُحصى مرةً واحدة للمادة لا لكل لغة. '
      + 'تُحصيها المنصة وتصحّحها إن أخطأت.'),
    h('div.row', wordsIn, h('span.small.muted', 'كلمة')),
    wordsNote);
  // أصلٌ صوتي: درسٌ أو مادة تصل مقطعًا صوتيًّا فيترجمها المترجم سماعًا (ملاحظة ١٥٧)
  const audioPrev = h('div.stack.src-audio-prev');
  const audioWrap = h('div.field',
    h('label.field', req('المقطع الصوتي العربي'),
      h('small', `الصيغ المعتمدة ${AUDIO_EXTS.map(x => x.toUpperCase()).join(' أو ')} — حتى ٢٠٠ ميغابايت`), f.audio),
    audioPrev,
    h('p.small.muted', 'يسمعه المترجم في مكان الأصل، ويكتب ترجمته على الكليشة أمامه.'));
  f.audio.onchange = async () => {
    audioPrev.replaceChildren();
    const file = f.audio.files[0];
    if (!file) return;
    if (!isAllowedAudio(file)) {
      audioPrev.append(h('p.small.bad', `الصيغة غير معتمدة — ${AUDIO_EXTS.map(x => x.toUpperCase()).join(' أو ')} فقط.`));
      f.audio.value = ''; return;
    }
    const url = URL.createObjectURL(file);
    audioPrev.append(h('audio', { controls: true, src: url, style: { width: '100%' } }));
    try {
      const info = await audioInfo(file);
      srcAudioSeconds = Math.round(info?.duration || 0) || null;
      audioPrev.append(h('span.small.muted', specLine(info)));
      if (info?.video) {
        audioPrev.replaceChildren(h('p.small.bad', 'هذا مقطع فيديو — ارفع صوتًا فقط.'));
        f.audio.value = '';
      }
    } catch { /* المتصفح لا يقرأ المواصفات أحيانًا، والصيغة كافية */ }
  };
  let srcAudioSeconds = null;
  // المواد العامة لا خطيب لها، فالمؤلف أو الجهة المصدرة إلزامي فيها (ملاحظة ١٤٢)
  const authorLabel = h('span');
  const authorWrap = h('label.field', authorLabel, f.author);
  const textWrap = h('div.field',
    h('div.row.between', h('b', 'النص العربي على كليشة الهيئة'),
      h('span.small.muted', 'ما تكتبه هنا هو ما يراه المترجم: الورقة نفسها بصفحاتها وعلامتها المائية')),
    h('div.ws-tools', source.tools),
    source.el);
  const isSermon = () => f.material_type.value === 'خطب';
  const syncVisibility = () => {
    sermonOnly.hidden = !isSermon();
    mosqueWrap.hidden = !needsMosque(f.material_type.value);
    pdfWrap.hidden = f.source_mode.value !== 'pdf';
    wordsWrap.hidden = f.source_mode.value === 'audio';
    textWrap.hidden = f.source_mode.value !== 'text';
    audioWrap.hidden = f.source_mode.value !== 'audio';
    // اسم الحقل وإلزامه يتغيران بتغير نوع المادة
    authorLabel.replaceChildren(isSermon()
      ? h('span', 'المؤلف أو الجهة المصدرة', h('small.muted', ' (اختياري للخطب)'))
      : req('المؤلف أو الجهة المصدرة'));
  };
  f.material_type.addEventListener('change', syncVisibility);
  f.source_mode.addEventListener('change', syncVisibility);
  syncVisibility();

  // ---------------- الخطوة ٢: الوقت ----------------
  const stageInputs = Object.fromEntries(slaStages.map(s => [s.key, h('input', { type: 'number', min: 0, step: 1 })]));
  const stageHints = Object.fromEntries(slaStages.map(s => [s.key, h('small')]));
  const totalMinutes = () => Math.max(1, Math.round(Number(f.total.value || 0) * Number(f.unit.value)));
  function distribute() {
    const w = slaStages.reduce((a, s) => a + Number(s.weight), 0) || 1;
    let used = 0;
    slaStages.forEach((s, i) => {
      const v = i === slaStages.length - 1 ? totalMinutes() - used : Math.floor(totalMinutes() * Number(s.weight) / w);
      used += v; stageInputs[s.key].value = v;
    });
    updateSum();
  }
  const sumLine = h('p.small');
  function updateSum() {
    const sum = slaStages.reduce((a, s) => a + Number(stageInputs[s.key].value || 0), 0);
    slaStages.forEach(s => { stageHints[s.key].textContent = fmtMinutes(Number(stageInputs[s.key].value || 0)); });
    const diff = totalMinutes() - sum;
    sumLine.className = 'small ' + (diff < 0 ? 'err' : 'muted');
    sumLine.textContent = `مجموع المراحل: ${fmtMinutes(sum)} من ${fmtMinutes(totalMinutes())}` + (diff < 0 ? ' — يتجاوز المدة الكلية' : diff > 0 ? ` · احتياطي ${fmtMinutes(diff)}` : '');
  }
  // ---------------- نافذة الخطبة (ملاحظة ١٨٩) ----------------
  // الخطبة تصل الثلاثاء أو الأربعاء، والتسليم قبل الجمعة بساعات أمان.
  // فالمدة الكلية تُؤخذ من الباقي فعلًا، لا من عدد أيامٍ مقطوع.
  const winNote = h('div.small.muted');
  const winBtn = h('button.btn.sm', { type: 'button' }, 'وزّع على ما بقي حتى الخطبة');
  let win = null;
  const winCard = h('div.card.stack.window-card', { hidden: true },
    h('div.row.between', h('b', 'نافذة التسليم'), winBtn), winNote);

  const fitWindow = () => {
    if (!win || !win.minutes) return;
    f.unit.value = '60';
    f.total.value = String(Math.max(1, Math.round(win.minutes / 60)));
    const sp = win.split || {};
    let any = false;
    slaStages.forEach(st => {
      if (sp[st.key] != null) { stageInputs[st.key].value = Number(sp[st.key]); any = true; }
    });
    if (!any) distribute(); else updateSum();
  };
  winBtn.onclick = () => fitWindow();

  const loadWindow = async () => {
    win = null;
    const isSermon = f.material_type.value === 'خطب';
    if (!isSermon || !f.sermon_date.value) { winCard.hidden = true; return; }
    winCard.hidden = false;
    winNote.className = 'small muted';
    winNote.textContent = 'جارٍ احتساب ما بقي…';
    try {
      const r = await db.rpc('sermon_window', { p_sermon_date: f.sermon_date.value });
      win = Array.isArray(r) ? r[0] : r;
    } catch { win = null; }
    if (!win) { winNote.textContent = 'تعذّر احتساب النافذة — وزّع المدة بنفسك.'; return; }
    const hrs = Number(win.hours || 0);
    if (!win.minutes) {
      winNote.className = 'small bad';
      winNote.textContent = 'مضى موعد التسليم لهذا التاريخ — راجع تاريخ الخطبة.';
      return;
    }
    winNote.className = 'small ' + (win.tight ? 'warn' : 'muted');
    winNote.textContent = `بقي حتى التسليم ${hrs.toLocaleString('en-US')} ساعة `
      + `(ينتهي العمل قبل الخطبة بـ${win.cutoff_hours} ساعات). `
      + (win.arrived_on_time
          ? 'وصلت المادة في موعدها المعتاد: الثلاثاء أو الأربعاء.'
          : 'وصلت المادة خارج الثلاثاء والأربعاء، فالنافذة أضيق من المعتاد.')
      + (win.tight ? ' وهي أقل من يوم: راجع الأهمية والإسناد.' : '');
  };
  f.sermon_date.addEventListener('change', loadWindow);
  f.material_type.addEventListener('change', loadWindow);

  // ---------- نوعُ المهمة وصفحاتُها: منهما مهلةُ التسليم (ملاحظة ١٩٧) ----------
  // العقد يجعل مدّة التسليم بعدد الصفحات ونوع المهمة: اعتيادية وعاجلة وطارئة،
  // لكلٍّ ثلاثُ درجاتٍ بالصفحات. والخطبةُ لها نافذتُها لا هذا الجدول.
  const URGENCY = { normal: 'اعتيادية', urgent: 'عاجلة', emergency: 'طارئة' };
  f.urgency = h('select', { 'aria-label': 'نوع المهمة' },
    Object.entries(URGENCY).map(([k, v]) =>
      h('option', { value: k, selected: (draft.urgency || 'normal') === k }, v)));
  f.pages = h('input', { type: 'number', min: 1, max: 5000, value: draft.pages || '',
    placeholder: 'تُقترح من الكلمات', 'aria-label': 'عدد الصفحات' });
  const dueNote = h('div.small.muted');
  const dueCard = h('div.card.stack.due-card', { hidden: true },
    h('b', 'مهلةُ التسليم في جدول العقد'),
    h('div.grid-2',
      h('label.field', 'نوع المهمة', f.urgency),
      h('label.field', 'عدد الصفحات',
        h('small', 'الصفحةُ نحو ٢٥٠ كلمة، فإن تُركت اقتُرحت من الكلمات'), f.pages)),
    dueNote);

  let deadlines = [];
  const pagesNow = () => {
    const v = Number(f.pages.value);
    if (v >= 1) return v;
    const w = Number(wordsIn.value);
    return w > 0 ? Math.max(1, Math.ceil(w / 250)) : null;
  };
  const showDue = () => {
    if (f.material_type.value === 'خطب' || !f.material_type.value) {
      dueCard.hidden = true; return;
    }
    dueCard.hidden = false;
    const pg = pagesNow();
    if (!deadlines.length) { dueNote.textContent = 'جارٍ قراءة جدول المدد…'; return; }
    if (!pg) {
      dueNote.className = 'small muted';
      dueNote.textContent = 'اكتب عدد الصفحات أو احسب الكلمات لتُعرف المهلة.';
      return;
    }
    const d = deadlines.filter(x => x.urgency === f.urgency.value
      && pg >= x.pages_from && (x.pages_to == null || pg <= x.pages_to))[0];
    if (!d) { dueNote.textContent = 'لا سطرَ لهذا العدد في جدول العقد.'; return; }
    dueNote.className = 'small ' + (d.needs_review ? 'warn' : 'muted');
    dueNote.textContent = (d.needs_review ? 'يحتاج استيضاحًا من الهيئة — ' : '')
      + `${pg} صفحة · ${URGENCY[f.urgency.value]} ← ${d.label}`
      + (d.description ? ` — ${d.description}` : '')
      + ' (تُحسب من وقت استلام المادة)';
  };
  f.urgency.addEventListener('change', showDue);
  f.pages.addEventListener('input', showDue);
  f.material_type.addEventListener('change', showDue);
  wordsIn.addEventListener('input', showDue);
  db.select('text_deadlines', { select: '*', order: 'urgency,pages_from' })
    .then(r => { deadlines = Array.isArray(r) ? r : []; showDue(); })
    .catch(() => { dueNote.textContent = 'تعذّر قراءة جدول المدد.'; });
  showDue();

  Object.values(stageInputs).forEach(i => i.addEventListener('input', updateSum));
  f.total.addEventListener('input', distribute); f.unit.addEventListener('change', distribute);
  f.priority.addEventListener('change', () => { f.total.value = PRIORITY_DAYS[f.priority.value] || 3; f.unit.value = '1440'; distribute(); });
  if (draft.stage_minutes) { slaStages.forEach(s => stageInputs[s.key].value = draft.stage_minutes[s.key] ?? 0); updateSum(); } else distribute();
  if (draft.sermon_date || f.sermon_date.value) loadWindow();

  // ---------------- الخطوة ٣: الإسناد ----------------
  const picked = new Map(); // code -> { stages: Map(key -> assigneeId), audio: stageKey }
  (draft.languages || []).forEach(l => picked.set(l.code, { stages: new Map(l.stages.map(s => [s.key, s.assignee])), audio: l.audio_stage || 'translation' }));
  const translatorStage = key => state.stages.find(s => s.key === key)?.assignee_role === 'translator';
  const langSearch = h('input', { type: 'search', placeholder: 'ابحث عن لغة' });
  const langPills = h('div.lang-pills');
  const assignBox = h('div.stack');

  function candidates(stage, code) {
    if (stage.assignee_role === 'manager') return members.filter(m => m.role === 'manager');
    // من أنشأ تَبِع: المنسقُ المسؤولُ عن المادة هو مُنشئُها، ولا يُلقيها
    // على غيره. ومديرُ المشروع — ومن مُنح مفتاحَ الإسناد — يختار من
    // يشاء (ملاحظة ٢٦٩)
    if (stage.assignee_role === 'coordinator') {
      if (!isManager() && !can('mat_assign_coord')) {
        return members.filter(m => m.id === state.profile?.id);
      }
      return members.filter(m => m.role === 'coordinator' || m.role === 'manager');
    }
    // ولا يظهر إلا من اعتُمدت له هذه اللغةُ للإسناد (ملاحظتا ١٧٣ و٢٤٩)
    return members.filter(m => assignOf(m).has(code));
  }
  function suggest(code) {
    const entry = picked.get(code); const used = new Set();
    for (const s of activeStages) {
      if (!entry.stages.has(s.key)) continue;
      const c = candidates(s, code);
      // صاحبُ الدور الافتراضيِّ في هذه اللغة أولًا، ثم الأولوية، ثم أقلُّهم حملًا
      const want = sugOf.get(`${code}|${s.key}`);
      const byRole = want && c.find(m => m.id === want);
      const choice = byRole
        || c.find(m => !used.has(m.id) && s.assignee_role === 'translator') || c[0];
      entry.stages.set(s.key, choice?.id || '');
      if (choice && s.assignee_role === 'translator') used.add(choice.id);
    }
  }

  // اقتراحُ الإسناد من المنصة: لكلِّ مرحلةٍ صاحبُ دورها الافتراضيِّ في هذه
  // اللغة، فإن تعدّدوا فبالأولوية، فإن استووا فأقلُّهم حملًا (ملاحظة ٢٥٠).
  // والمنصةُ تقترح ولا تعتمد: الكلمةُ الأخيرةُ للمنسّق.
  function addLang(code) {
    if (picked.has(code)) return;
    picked.set(code, { stages: new Map(activeStages.map(s => [s.key, ''])), audio: 'translation' });
    suggest(code);
  }
  function toggleLang(code) {
    if (picked.has(code)) picked.delete(code); else addLang(code);
    drawLangs(); drawAssign();
  }
  // تحديد جماعي مع إبقاء الاختيار الفردي (ملاحظة ٥٨)
  const activeLangs = () => state.languages.filter(l => l.is_active);
  const bulk = (pick, label) => h('button.btn.sm', { type: 'button', onclick: () => {
    pick(); drawLangs(); drawAssign();
  } }, label);
  const langCount = h('span.small.muted');
  const langBulk = h('div.row', { style: { gap: '8px', margin: '8px 0' } },
    bulk(() => activeLangs().forEach(l => addLang(l.code)), 'تحديد جميع اللغات'),
    bulk(() => activeLangs().filter(l => l.is_core).forEach(l => addLang(l.code)), 'اللغات الرئيسية'),
    bulk(() => picked.clear(), 'إلغاء التحديد'),
    langCount);
  function drawLangs() {
    const q = langSearch.value.trim();
    const core = activeLangs().filter(l => l.is_core).length;
    langCount.textContent = picked.size
      ? `المحدد: ${picked.size} من ${activeLangs().length} لغة`
      : `لم تُحدَّد لغة بعد — ${activeLangs().length} لغة متاحة، منها ${core} رئيسية`;
    langPills.replaceChildren(...state.languages.filter(l => l.is_active && (!q || l.name_ar.includes(q) || l.native_name.toLowerCase().includes(q.toLowerCase())))
      .map(l => {
        const n = members.filter(m => assignOf(m).has(l.code)).length;
        const on = picked.has(l.code);
        return h('button', { type: 'button', 'aria-pressed': String(on), title: n ? `${n} عضو مؤهل` : 'لا يوجد عضو مؤهل',
          onclick: () => toggleLang(l.code) },
          on ? h('span.tick', { 'aria-hidden': 'true' }, '✓') : '', l.name_ar, n ? '' : ' ⚠');
      }));
  }
  langSearch.addEventListener('input', drawLangs);
  f.deliverable.addEventListener('change', drawAssign);

  function drawAssign() {
    assignBox.replaceChildren(...[...picked.entries()].map(([code, entry]) => {
      const warnings = [];
      const tr = entry.stages.get('translation');
      if (tr && ['sharia_review', 'linguistic_review'].some(k => entry.stages.get(k) === tr)) warnings.push('المترجم نفسه يراجع ترجمته — يُفضَّل مراجع مستقل');
      if (!members.some(m => assignOf(m).has(code))) warnings.push('لا عضوَ معتمدًا للإسناد في هذه اللغة — اعتمد لغات الإسناد في شاشة الفريق');
      return h('fieldset',
        h('legend', langName(code)),
        h('div.row', { style: { marginBottom: '8px' } },
          h('button.btn.sm', { type: 'button', onclick: () => { activeStages.forEach(s => entry.stages.has(s.key) || entry.stages.set(s.key, '')); suggest(code); drawAssign(); } }, 'المسار الكامل'),
          h('button.btn.sm', { type: 'button', onclick: () => { activeStages.forEach(s => { if (!s.is_required) entry.stages.delete(s.key); }); drawAssign(); } }, 'مترجم ثم المنسق'),
          h('button.btn.sm.ghost', { type: 'button', onclick: () => toggleLang(code) }, 'إزالة اللغة')),
        h('div.grid', activeStages.map(s => {
          const on = entry.stages.has(s.key);
          const opts = candidates(s, code);
          const box = h('input', { type: 'checkbox', checked: on, disabled: s.is_required, onchange: e => {
            e.target.checked ? entry.stages.set(s.key, '') : entry.stages.delete(s.key); drawAssign();
          } });
          const select = h('select', { disabled: !on, 'aria-label': `مسؤول ${s.name_ar} — ${langName(code)}`, onchange: e => { entry.stages.set(s.key, e.target.value); drawAssign(); } },
            h('option', { value: '' }, opts.length ? '— اختر المسؤول —' : 'لا يوجد عضو مؤهل'),
            opts.map(m => h('option', { value: m.id, selected: entry.stages.get(s.key) === m.id }, m.full_name)));
          return h('div.stack', { style: { gap: '4px' } }, h('label.check', box, s.name_ar, s.is_required ? h('span.small.muted', '(أساسية)') : null), select);
        })),
        f.deliverable.value === 'text_audio' && (() => {
          const opts = activeStages.filter(s => entry.stages.has(s.key) && translatorStage(s.key));
          if (!opts.some(s => s.key === entry.audio)) entry.audio = 'translation';
          return h('label.field', { style: { marginTop: '8px', maxWidth: '420px' } }, 'مسؤول التسجيل الصوتي',
            h('small', 'التسجيل إلزامي من هذه المرحلة، ويمكن لمن بعدها الاستماع إليه واستبداله'),
            h('select', { onchange: e => { entry.audio = e.target.value; } },
              opts.map(s => h('option', { value: s.key, selected: entry.audio === s.key }, `${s.name_ar} — ${members.find(m => m.id === entry.stages.get(s.key))?.full_name || 'لم يُختر بعد'}`))));
        })(),
        h('p.small.muted', 'المسار: ' + activeStages.filter(s => entry.stages.has(s.key)).map(s => s.name_ar).join(' ← ')),
        warnings.map(w => h('p.small', { style: { color: 'var(--warn)' } }, '⚠ ' + w)));
    }));
    if (!picked.size) assignBox.append(h('p.muted', 'اختر لغة أو أكثر من القائمة أعلاه.'));
  }
  drawLangs(); drawAssign();

  // ---------------- التنقل بين الخطوات ----------------
  const errs = h('div.form-errors', { hidden: true, role: 'alert' });
  const steps = [
    h('div.stack',
      h('div.grid-2', h('label.field', req('نوع المادة'), f.material_type), mosqueWrap),
      sermonOnly,
      h('label.field', req('العنوان'), f.title),
      h('div.grid-2', h('label.field', req('التاريخ'), f.sermon_date), authorWrap),
      h('label.field', 'تفاصيل المادة وتعليمات الترجمة', f.instructions),
      h('div.grid-2', h('label.field', 'طريقة إدخال النص العربي', f.source_mode), h('label.field', 'المطلوب تسليمه', f.deliverable)),
      textWrap, pdfWrap, audioWrap, wordsWrap),
    h('div.stack',
      h('div.grid-2', h('label.field', 'مدى الأهمية', h('small', 'تضبط المدة الكلية تلقائيًا'), f.priority),
        h('div.field', h('b', 'المدة الكلية للتنفيذ'), h('div.row', f.total, f.unit)),
        h('label.field', 'مهلة الاستلام (بالدقائق)', h('small', 'تبدأ مدة الترجمة من لحظة قبول المترجم، لا من الإرسال'), f.receipt),
        h('label.field', 'التذكير قبل نهاية المرحلة', f.reminder)),
      h('fieldset', h('legend', 'الوقت المخصص لكل مرحلة (بالدقائق)'),
        h('div.grid', slaStages.map(s => h('label.field', s.name_ar, stageInputs[s.key], stageHints[s.key]))),
        h('div.row', sumLine, h('button.btn.sm', { type: 'button', onclick: distribute }, 'إعادة التوزيع التلقائي')),
        winCard,
        dueCard,
        h('p.small.muted', 'تُحدَّد المدة الكلية تلقائيًا حسب الأهمية: طارئة يوم، عاجلة يومان، اعتيادية ثلاثة أيام، وتُوزَّع على المراحل بالنسبة (الترجمة أطول من المراجعة، والاستلام أقصر). المدة تبدأ من قبول المترجم، والموعد النهائي ثابت: إن تأخرت مرحلة قلّ وقت ما بعدها، وإن سبقت زاد. إن اختُصر مسار لغة، يُوزَّع وقت المراحل المتجاوزة على مراحلها. اعتماد المدير خارج المدة.')),
      h('label.check', f.escalate, 'عند تجاوز الوقت: تنبيه مدير المشروع إضافةً إلى المسؤول والمنسق')),
    h('div.stack',
      h('label.field', 'اللغات', langSearch), langBulk, langPills,
      assignBox)
  ];
  const titles = ['١. بيانات المادة', '٢. الوقت والأهمية', '٣. اللغات والإسناد'];
  let step = 0;
  const stepNav = h('div.row');
  const body = h('div');
  const back = h('button.btn', { type: 'button', onclick: () => go(step - 1) }, 'السابق');
  const next = h('button.btn.primary', { type: 'button', onclick: () => go(step + 1) }, 'التالي');
  const send = h('button.btn.primary', { type: 'button', onclick: e => submit(e.currentTarget) }, 'إسناد وإرسال ←');

  // البيانات الرئيسة لا يُتجاوَز عنها: يُحمَّر الحقل الناقص ويُنتقل إليه (ملاحظة ١٤٢)
  const badFields = [];
  const need = (el, cond, msg, list) => { if (cond) { list.push(msg); badFields.push(el); markBad(el, true); } };
  function validate(i) {
    const e = [];
    badFields.forEach(el => markBad(el, false));
    badFields.length = 0;
    if (i === 0) {
      need(f.material_type, !f.material_type.value, 'حدّد نوع المادة', e);
      if (isSermon()) {
        need(f.sermon_type, !f.sermon_type.value, 'حدّد نوع الخطبة (جمعة، عرفة، عيد…)', e);
        need(f.khateeb_id, !f.khateeb_id.value, 'اختر الخطيب', e);
      } else if (f.material_type.value) {
        // المؤلف أو الجهة لغير الخطب — ولا يُطلب قبل اختيار نوع المادة
        need(f.author, !f.author.value.trim(), 'اكتب المؤلف أو الجهة المصدرة', e);
      }
      need(f.mosque, needsMosque(f.material_type.value) && !f.mosque.value, 'حدّد الجهة: المسجد الحرام أو المسجد النبوي', e);
      need(f.title, !f.title.value.trim(), 'اكتب عنوان المادة', e);
      need(f.sermon_date, !f.sermon_date.value, 'حدّد تاريخ المادة', e);
      if (f.source_mode.value === 'text') {
        need(source.el, !plainText(source.html), 'أدخل النص العربي — لا تُرسَل مادة بلا أصل', e);
      }
      if (f.source_mode.value === 'pdf') {
        const file = f.pdf.files[0];
        if (!file) need(f.pdf, true, 'أرفق ملف PDF العربي — لا تُرسَل مادة بلا أصل', e);
        else if (file.type !== 'application/pdf') need(f.pdf, true, 'الملف ليس PDF', e);
        else if (file.size > 20 * 1024 * 1024) need(f.pdf, true, 'حجم الملف أكبر من ٢٠ ميغابايت', e);
      }
      if (f.source_mode.value === 'audio') {
        const file = f.audio.files[0];
        if (!file) need(f.audio, true, 'ارفع المقطع الصوتي العربي — لا تُرسَل مادة بلا أصل', e);
        else if (!isAllowedAudio(file)) need(f.audio, true, `صيغة المقطع غير معتمدة — ${AUDIO_EXTS.map(x => x.toUpperCase()).join(' أو ')} فقط`, e);
        else if (file.size > 200 * 1024 * 1024) need(f.audio, true, 'حجم المقطع أكبر من ٢٠٠ ميغابايت', e);
      }
    }
    if (i === 1) {
      const sum = slaStages.reduce((a, s) => a + Number(stageInputs[s.key].value || 0), 0);
      if (sum <= 0) e.push('حدد مدة المراحل');
      if (sum > totalMinutes()) e.push('مجموع مدد المراحل يتجاوز المدة الكلية');
      if (Number(f.receipt.value) < 5) e.push('مهلة الاستلام ٥ دقائق على الأقل');
    }
    if (i === 2) {
      if (!picked.size) e.push('اختر لغة واحدة على الأقل');
      for (const [code, entry] of picked) for (const [key, who] of entry.stages) if (!who) e.push(`${langName(code)}: اختر مسؤول «${stageName(key)}»`);
    }
    return e;
  }
  const showErrors = e => {
    errs.replaceChildren(h('b', '⚠ أكمل البيانات المطلوبة قبل المتابعة:'), h('ul', e.map(x => h('li', x))));
    errs.hidden = false;
    errs.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const first = badFields[0];
    if (first && first.focus) setTimeout(() => first.focus({ preventScroll: true }), 300);
  };
  function go(i) {
    if (i > step) { const e = validate(step); if (e.length) { showErrors(e); return; } errs.hidden = true; }
    errs.hidden = true;
    step = Math.max(0, Math.min(2, i));
    stepNav.replaceChildren(...titles.map((t, j) => h('span.badge', { class: j === step ? 'gold' : j < step ? 'ok' : '' }, t)));
    body.replaceChildren(steps[step]);
    back.hidden = step === 0; next.hidden = step === 2; send.hidden = step !== 2;
    saveDraft();
  }

  function payload(sourcePdfPath, sourceAudioPath) {
    const stage_minutes = Object.fromEntries(slaStages.map(s => [s.key, Number(stageInputs[s.key].value || 0)]));
    return {
      material: {
        material_type: f.material_type.value,
        sermon_type: f.material_type.value === 'خطب' ? f.sermon_type.value : null,
        title: f.title.value.trim(), mosque: needsMosque(f.material_type.value) ? f.mosque.value : GENERAL_MOSQUE,
        khateeb_id: f.material_type.value === 'خطب' && f.khateeb_id.value ? f.khateeb_id.value : null,
        sermon_date: f.sermon_date.value || null, author: f.author.value.trim() || null,
        instructions: f.instructions.value.trim() || null,
        source_html: f.source_mode.value === 'text' ? source.html : null,
        source_pdf_path: sourcePdfPath || null,
        source_audio_path: sourceAudioPath || null,
        deliverable: f.deliverable.value, priority: f.priority.value,
        receipt_minutes: Number(f.receipt.value), reminder_minutes: Number(f.reminder.value),
        escalate_to_manager: f.escalate.checked,
        feed_record_id: null
      },
      stage_minutes,
      languages: [...picked.entries()].map(([code, entry]) => ({
        code, audio_stage: entry.audio || 'translation',
        stages: activeStages.filter(s => entry.stages.has(s.key)).map(s => ({ key: s.key, assignee: entry.stages.get(s.key) }))
      }))
    };
  }
  function saveDraft() {
    try {
      const p = payload(null);
      localStorage.setItem(DRAFT, JSON.stringify({
        ...Object.fromEntries(Object.entries(f).filter(([, el]) => el.type !== 'file').map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value])),
        source_html: source.html, stage_minutes: p.stage_minutes, languages: p.languages
      }));
    } catch { /* */ }
  }
  const draftTimer = setInterval(() => { if (!body.isConnected) return clearInterval(draftTimer); saveDraft(); }, 5000);

  async function submit(btn) {
    for (const i of [0, 1, 2]) { const e = validate(i); if (e.length) { step = i; go(i); showErrors(e); return; } }
    const langs = [...picked.keys()].map(langName).join('، ');
    if (!await confirm('إرسال المادة', `ستُسند «${f.title.value.trim()}» إلى ${picked.size} لغة (${langs})، وتظهر فورًا في مهام المسؤولين. متابعة؟`, 'إسناد وإرسال')) return;
    await busy(btn, async () => {
      try {
        let pdfPath = null, audioPath = null;
        if (f.source_mode.value === 'pdf') pdfPath = await storage.upload('sources', `${crypto.randomUUID()}.pdf`, f.pdf.files[0]);
        if (f.source_mode.value === 'audio') {
          const file = f.audio.files[0];
          const ext = (file.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
          audioPath = await storage.upload('sources', `${crypto.randomUUID()}.${ext}`, file);
        }
        const newId = await db.rpc('create_material', { p: payload(pdfPath, audioPath) });
        // كلمات الأصل تُحفظ مع المادة، فيقوم عليها احتساب العقد (ملاحظة ١٨٨)
        const wn = wordsIn.value === '' ? null : Number(wordsIn.value);
        if (newId && wn != null && wn >= 0) {
          db.rpc('set_material_words', {
            p_material: String(newId).replace(/"/g, ''), p_words: wn, p_auto: autoWords })
            .catch(() => {});
        }
        // نوعُ المهمة وصفحاتُها: منهما مهلةُ التسليم (ملاحظة ١٩٧)
        if (newId && f.material_type.value !== 'خطب') {
          db.rpc('set_material_text_plan', {
            p_material: String(newId).replace(/"/g, ''),
            p_urgency: f.urgency.value,
            p_pages: f.pages.value === '' ? null : Number(f.pages.value),
            p_received: null }).catch(() => {});
        }
        // مدة الأصل الصوتي تُقاس في المتصفح، فتُحفظ ليظهر طولها للمترجم
        if (audioPath && srcAudioSeconds && newId) {
          db.rpc('set_source_audio_seconds', { p_material: String(newId).replace(/"/g, ''), p_seconds: srcAudioSeconds })
            .catch(() => {});
        }
        try { localStorage.removeItem(DRAFT); } catch { /* */ }
        toast('أُسندت المادة. تنتظر الآن استلام المترجمين.', 'ok');
        ctx.navigate('/app');
      } catch (err) { errs.replaceChildren(h('ul', h('li', err.message))); errs.hidden = false; errs.scrollIntoView({ block: 'center' }); }
    });
  }

  go(0);
  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'مادة جديدة'), h('h1', 'إضافة مادة للترجمة'),
      h('p.muted', 'اللغة الأصلية: العربية. تُحفظ مسودتك تلقائيًا على هذا الجهاز.')),
      h('button.btn.ghost', { type: 'button', onclick: async () => { if (await confirm('مسح المسودة', 'تُمسح كل الحقول. متابعة؟', 'مسح', 'danger')) { try { localStorage.removeItem(DRAFT); } catch { /* */ } location.reload(); } } }, 'مسح المسودة')),
    h('div.card.stack', stepNav, errs, body, h('div.row', back, next, send)));
}
