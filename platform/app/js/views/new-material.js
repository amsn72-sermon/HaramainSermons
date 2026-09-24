// إضافة مادة وإسنادها — على ثلاث خطوات مع حفظ مسودة محلية
import { h, fill, toast, busy, fmtMinutes, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, MATERIAL_TYPES, SERMON_TYPES, MOSQUE, PRIORITY, langName, stageName } from '../store.js';
import { createEditor } from '../editor.js';
import { plainText } from '../sanitize.js';

const DRAFT = 'hs.material-draft';
// ٣. المدة الكلية تُحدَّد تلقائيًا حسب الأهمية (بالأيام)، وتبقى قابلة للتعديل
const PRIORITY_DAYS = { emergency: 1, urgent: 2, normal: 3 };

export async function render(ctx) {
  const members = await db.select('profiles', {
    select: 'id,full_name,role,member_languages(language_code)', status: 'eq.active', order: 'full_name.asc'
  });
  const feed = await fetch(window.HS_CONFIG.feedUrl, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const langsOf = m => new Set((m.member_languages || []).map(x => x.language_code));
  const activeStages = state.stages.filter(s => s.is_active);
  const slaStages = activeStages.filter(s => !s.outside_sla);

  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch { /* */ }

  // ---------------- الخطوة ١: بيانات المادة ----------------
  const f = {
    material_type: h('select', MATERIAL_TYPES.map(t => h('option', t))),
    sermon_type: h('select', SERMON_TYPES.map(t => h('option', t))),
    title: h('input', { placeholder: 'عنوان المادة', maxlength: 300 }),
    mosque: h('select', Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v))),
    khateeb_id: h('select'),
    sermon_date: h('input', { type: 'date' }),
    author: h('input'),
    instructions: h('textarea', { placeholder: 'السياق، متطلبات الصياغة، وطريقة الاستخدام' }),
    source_mode: h('select', h('option', { value: 'text' }, 'إدخال النص مباشرة'), h('option', { value: 'pdf' }, 'إرفاق ملف PDF عربي')),
    pdf: h('input', { type: 'file', accept: 'application/pdf' }),
    deliverable: h('select', h('option', { value: 'text_audio' }, 'ترجمة كتابية مع تسجيل صوتي'), h('option', { value: 'text' }, 'ترجمة كتابية فقط')),
    priority: h('select', Object.entries(PRIORITY).map(([k, v]) => h('option', { value: k }, v))),
    total: h('input', { type: 'number', min: 1, value: PRIORITY_DAYS.normal }),
    unit: h('select', h('option', { value: '60' }, 'ساعات'), h('option', { value: '1440', selected: true }, 'أيام')),
    receipt: h('input', { type: 'number', min: 5, value: 120 }),
    reminder: h('select', [5, 15, 30, 60].map(n => h('option', { value: n, selected: n === 15 }, fmtMinutes(n)))),
    escalate: h('input', { type: 'checkbox' }),
    feed_record_id: h('select')
  };
  const source = createEditor({ plain: true, label: 'النص العربي', placeholder: 'اكتب النص العربي أو الصقه هنا…', html: draft.source_html || '' });
  for (const [k, el] of Object.entries(f)) if (draft[k] !== undefined && el.type !== 'file') el.type === 'checkbox' ? (el.checked = draft[k]) : (el.value = draft[k]);

  function fillKhateebs() {
    const keep = f.khateeb_id.value;
    fill(f.khateeb_id, h('option', { value: '' }, '— اختر —'),
      state.khateebs.filter(k => k.mosque === f.mosque.value && k.is_active).map(k => h('option', { value: k.id }, k.name)));
    f.khateeb_id.value = keep;
  }
  fillKhateebs(); if (draft.khateeb_id) f.khateeb_id.value = draft.khateeb_id;
  // ربط اختياري بتسجيل الخطبة في أرشيف يوتيوب، لتظهر الترجمة المكتوبة تحت الفيديو في الموقع العام
  function fillFeed() {
    const keep = f.feed_record_id.value;
    const recs = [...(feed?.current || []), ...(feed?.archive || [])]
      .filter(r => (r.venue === 'madinah' ? 'madinah' : 'makkah') === f.mosque.value).slice(0, 40);
    fill(f.feed_record_id, h('option', { value: '' }, feed ? '— بلا ربط —' : 'تعذّر تحميل أرشيف يوتيوب'),
      recs.map(r => h('option', { value: r.id }, `${r.title}`)));
    f.feed_record_id.value = keep;
  }
  fillFeed(); if (draft.feed_record_id) f.feed_record_id.value = draft.feed_record_id;
  f.mosque.addEventListener('change', () => { fillKhateebs(); fillFeed(); });

  const sermonOnly = h('div.grid-2',
    h('label.field', 'نوع الخطبة', f.sermon_type),
    h('label.field', 'الخطيب', f.khateeb_id),
    h('label.field', 'تسجيل الخطبة على يوتيوب', h('small', 'اختياري: يربط الترجمة المكتوبة بالفيديو في الموقع العام'), f.feed_record_id));
  const pdfWrap = h('label.field', 'ملف الأصل العربي (PDF)', h('small', 'حتى ٢٠ ميغابايت'), f.pdf);
  const textWrap = h('div.field', h('b', 'النص العربي'), source.el);
  const syncVisibility = () => {
    sermonOnly.hidden = f.material_type.value !== 'خطب';
    pdfWrap.hidden = f.source_mode.value !== 'pdf';
    textWrap.hidden = f.source_mode.value !== 'text';
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
  Object.values(stageInputs).forEach(i => i.addEventListener('input', updateSum));
  f.total.addEventListener('input', distribute); f.unit.addEventListener('change', distribute);
  f.priority.addEventListener('change', () => { f.total.value = PRIORITY_DAYS[f.priority.value] || 3; f.unit.value = '1440'; distribute(); });
  if (draft.stage_minutes) { slaStages.forEach(s => stageInputs[s.key].value = draft.stage_minutes[s.key] ?? 0); updateSum(); } else distribute();

  // ---------------- الخطوة ٣: الإسناد ----------------
  const picked = new Map(); // code -> { stages: Map(key -> assigneeId), audio: stageKey }
  (draft.languages || []).forEach(l => picked.set(l.code, { stages: new Map(l.stages.map(s => [s.key, s.assignee])), audio: l.audio_stage || 'translation' }));
  const translatorStage = key => state.stages.find(s => s.key === key)?.assignee_role === 'translator';
  const langSearch = h('input', { type: 'search', placeholder: 'ابحث عن لغة' });
  const langPills = h('div.lang-pills');
  const assignBox = h('div.stack');

  function candidates(stage, code) {
    if (stage.assignee_role === 'manager') return members.filter(m => m.role === 'manager');
    if (stage.assignee_role === 'coordinator') return members.filter(m => m.role === 'coordinator' || m.role === 'manager');
    return members.filter(m => langsOf(m).has(code));
  }
  function suggest(code) {
    const entry = picked.get(code); const used = new Set();
    for (const s of activeStages) {
      if (!entry.stages.has(s.key)) continue;
      const c = candidates(s, code);
      const choice = c.find(m => !used.has(m.id) && s.assignee_role === 'translator') || c[0];
      entry.stages.set(s.key, choice?.id || '');
      if (choice && s.assignee_role === 'translator') used.add(choice.id);
    }
  }
  function toggleLang(code) {
    if (picked.has(code)) picked.delete(code);
    else { picked.set(code, { stages: new Map(activeStages.map(s => [s.key, ''])), audio: 'translation' }); suggest(code); }
    drawLangs(); drawAssign();
  f.deliverable.addEventListener('change', drawAssign);
  }
  function drawLangs() {
    const q = langSearch.value.trim();
    langPills.replaceChildren(...state.languages.filter(l => l.is_active && (!q || l.name_ar.includes(q) || l.native_name.toLowerCase().includes(q.toLowerCase())))
      .map(l => {
        const n = members.filter(m => langsOf(m).has(l.code)).length;
        const on = picked.has(l.code);
        return h('button', { type: 'button', 'aria-pressed': String(on), title: n ? `${n} عضو مؤهل` : 'لا يوجد عضو مؤهل',
          onclick: () => toggleLang(l.code) },
          on ? h('span.tick', { 'aria-hidden': 'true' }, '✓') : '', l.name_ar, n ? '' : ' ⚠');
      }));
  }
  langSearch.addEventListener('input', drawLangs);

  function drawAssign() {
    assignBox.replaceChildren(...[...picked.entries()].map(([code, entry]) => {
      const warnings = [];
      const tr = entry.stages.get('translation');
      if (tr && ['sharia_review', 'linguistic_review'].some(k => entry.stages.get(k) === tr)) warnings.push('المترجم نفسه يراجع ترجمته — يُفضَّل مراجع مستقل');
      if (!members.some(m => langsOf(m).has(code))) warnings.push('لا يوجد عضو مؤهل في هذه اللغة — حدّث لغات الفريق');
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
      h('div.grid-2', h('label.field', 'نوع المادة', f.material_type), h('label.field', 'مكان الخطبة / الموقع', f.mosque)),
      sermonOnly,
      h('label.field', 'العنوان', f.title),
      h('div.grid-2', h('label.field', 'التاريخ', f.sermon_date), h('label.field', 'المؤلف أو الجهة المصدرة', f.author)),
      h('label.field', 'تفاصيل المادة وتعليمات الترجمة', f.instructions),
      h('div.grid-2', h('label.field', 'طريقة إدخال النص العربي', f.source_mode), h('label.field', 'المطلوب تسليمه', f.deliverable)),
      textWrap, pdfWrap),
    h('div.stack',
      h('div.grid-2', h('label.field', 'مدى الأهمية', h('small', 'تضبط المدة الكلية تلقائيًا'), f.priority),
        h('div.field', h('b', 'المدة الكلية للتنفيذ'), h('div.row', f.total, f.unit)),
        h('label.field', 'مهلة الاستلام (بالدقائق)', h('small', 'تبدأ مدة الترجمة من لحظة قبول المترجم، لا من الإرسال'), f.receipt),
        h('label.field', 'التذكير قبل نهاية المرحلة', f.reminder)),
      h('fieldset', h('legend', 'الوقت المخصص لكل مرحلة (بالدقائق)'),
        h('div.grid', slaStages.map(s => h('label.field', s.name_ar, stageInputs[s.key], stageHints[s.key]))),
        h('div.row', sumLine, h('button.btn.sm', { type: 'button', onclick: distribute }, 'إعادة التوزيع التلقائي')),
        h('p.small.muted', 'تُحدَّد المدة الكلية تلقائيًا حسب الأهمية: طارئة يوم، عاجلة يومان، اعتيادية ثلاثة أيام، وتُوزَّع على المراحل بالنسبة (الترجمة أطول من المراجعة، والاستلام أقصر). المدة تبدأ من قبول المترجم، والموعد النهائي ثابت: إن تأخرت مرحلة قلّ وقت ما بعدها، وإن سبقت زاد. إن اختُصر مسار لغة، يُوزَّع وقت المراحل المتجاوزة على مراحلها. اعتماد المدير خارج المدة.')),
      h('label.check', f.escalate, 'عند تجاوز الوقت: تنبيه مدير المشروع إضافةً إلى المسؤول والمنسق')),
    h('div.stack',
      h('label.field', 'اللغات', langSearch), langPills,
      assignBox)
  ];
  const titles = ['١. بيانات المادة', '٢. الوقت والأهمية', '٣. اللغات والإسناد'];
  let step = 0;
  const stepNav = h('div.row');
  const body = h('div');
  const back = h('button.btn', { type: 'button', onclick: () => go(step - 1) }, 'السابق');
  const next = h('button.btn.primary', { type: 'button', onclick: () => go(step + 1) }, 'التالي');
  const send = h('button.btn.primary', { type: 'button', onclick: e => submit(e.currentTarget) }, 'إسناد وإرسال ←');

  function validate(i) {
    const e = [];
    if (i === 0) {
      if (!f.title.value.trim()) e.push('اكتب عنوان المادة');
      if (f.source_mode.value === 'text' && !plainText(source.html)) e.push('أدخل النص العربي');
      if (f.source_mode.value === 'pdf') {
        const file = f.pdf.files[0];
        if (!file) e.push('أرفق ملف PDF العربي');
        else if (file.type !== 'application/pdf') e.push('الملف ليس PDF');
        else if (file.size > 20 * 1024 * 1024) e.push('حجم الملف أكبر من ٢٠ ميغابايت');
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
  function go(i) {
    if (i > step) { const e = validate(step); errs.replaceChildren(h('ul', e.map(x => h('li', x)))); errs.hidden = !e.length; if (e.length) return; }
    errs.hidden = true;
    step = Math.max(0, Math.min(2, i));
    stepNav.replaceChildren(...titles.map((t, j) => h('span.badge', { class: j === step ? 'gold' : j < step ? 'ok' : '' }, t)));
    body.replaceChildren(steps[step]);
    back.hidden = step === 0; next.hidden = step === 2; send.hidden = step !== 2;
    saveDraft();
  }

  function payload(sourcePdfPath) {
    const stage_minutes = Object.fromEntries(slaStages.map(s => [s.key, Number(stageInputs[s.key].value || 0)]));
    return {
      material: {
        material_type: f.material_type.value,
        sermon_type: f.material_type.value === 'خطب' ? f.sermon_type.value : null,
        title: f.title.value.trim(), mosque: f.mosque.value,
        khateeb_id: f.material_type.value === 'خطب' && f.khateeb_id.value ? f.khateeb_id.value : null,
        sermon_date: f.sermon_date.value || null, author: f.author.value.trim() || null,
        instructions: f.instructions.value.trim() || null,
        source_html: f.source_mode.value === 'text' ? source.html : null,
        source_pdf_path: sourcePdfPath || null,
        deliverable: f.deliverable.value, priority: f.priority.value,
        receipt_minutes: Number(f.receipt.value), reminder_minutes: Number(f.reminder.value),
        escalate_to_manager: f.escalate.checked,
        feed_record_id: f.material_type.value === 'خطب' && f.feed_record_id.value ? f.feed_record_id.value : null
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
    for (const i of [0, 1, 2]) { const e = validate(i); if (e.length) { go(i); errs.replaceChildren(h('ul', e.map(x => h('li', x)))); errs.hidden = false; return; } }
    const langs = [...picked.keys()].map(langName).join('، ');
    if (!await confirm('إرسال المادة', `ستُسند «${f.title.value.trim()}» إلى ${picked.size} لغة (${langs})، وتظهر فورًا في مهام المسؤولين. متابعة؟`, 'إسناد وإرسال')) return;
    await busy(btn, async () => {
      try {
        let pdfPath = null;
        if (f.source_mode.value === 'pdf') pdfPath = await storage.upload('sources', `${crypto.randomUUID()}.pdf`, f.pdf.files[0]);
        await db.rpc('create_material', { p: payload(pdfPath) });
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
