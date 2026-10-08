// الشهادات: شهاداتُ الدورات وشهاداتُ الخبرة (ملاحظة ٢٦٧)
//
//   يُنشئها المنسقُ مسوّدةً، ويعتمدها مديرُ المشروع فتصدر ويُمنح لها
//   رقمٌ متسلسلٌ موحَّد. وعليها باركودٌ يفتح صفحةَ تحقّقٍ عامّة. ولا
//   تُمنح إلا لمستحقٍّ بقرار.
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { state, isManager, can } from '../store.js';
import { printCertificate, certVerifyUrl, CERT_THEMES } from '../certdoc.js';
import { prepareMark } from '../photo.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');

const KIND_LABEL = { course: 'دورة تدريبية', experience: 'خبرة' };
const STATE = { draft: ['مسوّدة', 'warn'], issued: ['صادرة', 'ok'], revoked: ['ملغاة', 'bad'] };

export async function render() {
  const list = h('div.stack');
  const tabs = h('div.tabs');
  let want = '';

  const addBtn = can('cert_draft')
    ? h('button.btn.sm.primary', { type: 'button', onclick: () => grantDialog() }, '＋ منحُ شهادة')
    : null;
  const oldBtn = can('cert_draft')
    ? h('button.btn.sm.ghost', { type: 'button', onclick: () => edit(null) }, 'شهادةٌ ببيانات')
    : null;

  const page = h('div',
    h('div.page-head',
      h('div', h('p.eyebrow', 'الفريق'), h('h2', 'الشهادات')),
      h('div.row', addBtn, oldBtn)),
    h('p.lead', 'شهاداتُ الدورات التدريبية وشهاداتُ الخبرة. يُنشئها المنسق مسوّدةً، '
      + 'ويعتمدها مديرُ المشروع فتصدر برقمها وباركودِ تحقّقها.'),
    tabs, h('div.card.stack', list));

  // قالبُ التصميم المحفوظ: يسري على كلِّ شهادةٍ تُصدَر (ملاحظة ٣١٢)
  let tpl = {};
  try { tpl = (await db.rpc('cert_design')) || {}; } catch { tpl = {}; }

  let members = [];
  try {
    members = await db.select('profiles', { select: 'id,full_name,role,status',
      status: 'eq.active', order: 'full_name.asc' }) || [];
  } catch { /* تبقى القائمةُ فارغةً فيُنبَّه عند الإنشاء */ }
  const nameOf = id => members.find(m => m.id === id)?.full_name || '';

  function drawTabs() {
    fill(tabs, [
      ...[['', 'الكل'], ['draft', 'المسوّدات'], ['issued', 'الصادرة'], ['revoked', 'الملغاة']]
        .map(([k, label]) => {
          const b = h('button.tab', { type: 'button', 'aria-selected': want === k ? 'true' : 'false' }, label);
          b.onclick = () => { want = k; drawTabs(); draw(); };
          return b;
        }),
      // قوالبُ الشهادات تبويبٌ مستقل (ملاحظة ٣٢٤)
      (isManager() || can('cert_design'))
        ? (() => {
            const b = h('button.tab', { type: 'button',
              'aria-selected': want === 'templates' ? 'true' : 'false' }, '🖌 قوالبُ الشهادات');
            b.onclick = () => { want = 'templates'; drawTabs(); draw(); };
            return b;
          })()
        : null
    ].filter(Boolean));
  }

  async function draw() {
    fill(list, h('p.muted', 'يُحمَّل…'));
    if (want === 'templates') return drawTemplates();
    let rows = [];
    try { rows = await db.rpc('certificates_list', { p_status: want || null }) || []; }
    catch (err) { fill(list, h('p.muted', err.message)); return; }
    if (!rows.length) {
      fill(list, emptyState('لا شهادات', 'ما مُنحت شهادةٌ بعد في هذه القائمة.'));
      return;
    }
    fill(list, rows.map(card));
  }

  // -------------------------------------------------------------------
  // قوالبُ الشهادات: بطاقةٌ لكلِّ قالب (ملاحظة ٣٢٤)
  // -------------------------------------------------------------------
  async function drawTemplates() {
    let rows = [];
    try { rows = await db.rpc('cert_templates_list', { p_active: null }) || []; }
    catch (err) { fill(list, h('p.muted', err.message)); return; }

    fill(list,
      h('p.small.muted', 'كلُّ قالبٍ يحمل تصميمَه وبياناتِه الثابتة. '
        + 'ويُمنَح به فلا يبقى إلا اسمُ صاحب الشهادة.'),
      h('div.row',
        h('a.btn.sm.primary', { href: '/app/cert-design' }, '＋ قالبٌ جديد')),
      rows.length
        ? h('div.stack', rows.map(t => h('div.card.stack.tpl-card',
            h('div.row.between.wrap',
              h('div',
                h('b', t.name),
                h('div.small.muted',
                  `${t.kind === 'experience' ? 'شهادةُ خبرة' : 'شهادةُ دورة'}`
                  + ` · صدر عنه ${AR(t.issued || 0)}`
                  + (t.is_active ? '' : ' · معطَّل'))),
              h('div.row', { style: { gap: '6px' } },
                h('a.btn.xs', { href: `/app/cert-design?tpl=${t.id}` }, 'حرِّرْه'),
                can('cert_draft')
                  ? h('button.btn.xs.primary', { type: 'button',
                      onclick: () => grantDialog(t.id) }, 'امنحْ به')
                  : null,
                isManager()
                  ? h('button.btn.xs.ghost', { type: 'button',
                      onclick: () => removeTemplate(t) }, t.issued ? 'عطِّلْه' : 'احذفْه')
                  : null)))))
        : emptyState('لا قوالبَ بعد', 'أنشئْ قالبًا ليُمنَح به.'));
  }

  async function removeTemplate(t) {
    const issued = Number(t.issued || 0);
    if (!await confirm(issued ? 'تعطيلُ قالب' : 'حذفُ قالب',
      issued ? `صدر عن «${t.name}» ${AR(issued)} شهادة، فلا يُحذف — ويُعطَّل فلا يُمنَح به بعدُ.`
             : `يُحذف قالبُ «${t.name}».`,
      issued ? 'عطِّلْه' : 'احذفْه', 'danger')) return;
    try {
      await db.rpc('delete_cert_template', { p_id: t.id });
      toast(issued ? 'عُطِّل القالب.' : 'حُذف القالب.', 'ok');
      draw();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // -------------------------------------------------------------------
  // المنحُ بالقالب: الأسماءُ أوّلًا ثم القالبُ ثم الإصدار (ملاحظة ٣٢٤)
  // -------------------------------------------------------------------
  async function grantDialog(tplId) {
    let tpls = [];
    try { tpls = await db.rpc('cert_templates_list', { p_active: true }) || []; }
    catch { tpls = []; }
    if (!tpls.length) {
      toast('لا قوالبَ بعد — أنشئْ قالبًا من «قوالبُ الشهادات».', 'warn');
      return;
    }

    const q = h('input', { type: 'search', placeholder: 'ابحثْ بالاسم',
      'aria-label': 'البحث عن عضو' });
    const box = h('div.pick-list.tall');
    const chosen = new Set();
    const paintList = () => {
      const k = q.value.trim();
      fill(box, members
        .filter(m => !k || (m.full_name || '').includes(k))
        .slice(0, 400)
        .map(m => {
          const on = h('input', { type: 'checkbox', checked: chosen.has(m.id),
            'aria-label': m.full_name });
          on.onchange = () => { on.checked ? chosen.add(m.id) : chosen.delete(m.id); count(); };
          return h('label.check.pick-row', on, h('span', m.full_name));
        }));
    };
    const tally = h('span.small.muted');
    const count = () => { tally.textContent = `اختير ${AR(chosen.size)}`; };
    q.oninput = paintList; paintList(); count();

    const sel = h('select', { 'aria-label': 'القالب' },
      tpls.map(t => h('option', { value: t.id, selected: tplId === t.id }, t.name)));
    const issueNow = h('input', { type: 'checkbox', checked: can('cert_issue') || isManager(),
      'aria-label': 'إصدار مباشر' });

    let done = null;
    const res = await dialog({
      title: 'منحُ شهادة',
      body: h('div.stack',
        h('p.small.muted', 'اختَرِ الأسماءَ ثم القالب. وبياناتُ الشهادة تُؤخذ من القالب '
          + 'وبياناتِ العضو، فلا يُملأ شيءٌ هنا.'),
        h('label.field', 'الأسماء', q),
        box, tally,
        h('label.field', 'القالب', sel),
        h('label.check', issueNow, h('span', 'أصدِرْها فورًا برقمها وباركودِها'))),
      buttons: [{ label: 'امنحْ', kind: 'primary',
        validate: async () => {
          if (!chosen.size) return 'اختَرْ عضوًا واحدًا على الأقل';
          try {
            done = await db.rpc('grant_certificates',
              { p_template: sel.value, p_members: [...chosen], p_issue: issueNow.checked });
          } catch (e) { return e.message; }
          return true;
        },
        value: () => done }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    toast(`مُنحت ${AR(res.created || 0)} شهادة`
      + (res.issued ? ` وصدرت ${AR(res.issued)}` : ' مسوّدةً'), 'ok');
    want = res.issued ? 'issued' : 'draft';
    drawTabs(); draw();
  }

  function card(c) {
    const [label, tone] = STATE[c.status] || STATE.draft;
    const open = h('button.btn.xs', { type: 'button' }, '👁 معاينة');
    open.onclick = () => openCert(c);

    const issue = (c.status === 'draft' && can('cert_issue'))
      ? h('button.btn.xs.primary', { type: 'button' }, 'اعتمادٌ وإصدار') : null;
    if (issue) issue.onclick = () => busy(issue, async () => {
      try {
        const no = await db.rpc('issue_certificate', { p_cert: c.id });
        toast(`صدرت الشهادةُ برقم ${no}.`, 'ok'); draw();
      } catch (err) { toast(err.message, 'bad'); }
    });

    const editBtn = (c.status === 'draft' && can('cert_draft'))
      ? h('button.btn.xs', { type: 'button', onclick: () => edit(c) }, 'تعديل') : null;

    const revoke = (c.status === 'issued' && can('cert_revoke'))
      ? h('button.btn.xs.danger', { type: 'button' }, 'إلغاء') : null;
    if (revoke) revoke.onclick = async () => {
      const why = h('input', { 'aria-label': 'سبب الإلغاء', placeholder: 'صدرت بخطأ في…' });
      const res = await dialog({
        title: 'إلغاءُ شهادة',
        body: h('div.stack',
          h('p.small.muted', 'الشهادةُ الملغاةُ تبقى في السجلِّ ويُعلَن إلغاؤها في صفحة التحقق، '
            + 'ولا تُحذف — فالرقمُ المسحوبُ أثر.'),
          h('label.field', 'السبب', why)),
        buttons: [{ label: 'إلغاء الشهادة', kind: 'danger', value: () => why.value.trim() },
                  { label: 'تراجع', value: null }]
      });
      if (res === null) return;
      try { await db.rpc('revoke_certificate', { p_cert: c.id, p_why: res || null });
        toast('أُلغيت الشهادة.', 'ok'); draw(); }
      catch (err) { toast(err.message, 'bad'); }
    };

    const link = c.serial_no
      ? h('a.small', { href: certVerifyUrl(c), target: '_blank', rel: 'noopener', dir: 'ltr' }, c.serial_no)
      : h('span.small.muted', 'بلا رقمٍ حتى تُعتمد');

    return h('div.cert-row',
      h('div', { style: { flex: 1, minWidth: '220px' } },
        h('b', c.title),
        h('div.small.muted', `${KIND_LABEL[c.kind] || ''} · ${c.member_name}`),
        h('div.small.muted', c.hours ? `${c.hours} ساعة · ` : '',
          c.start_on ? fmtDate(c.start_on) : '', c.end_on ? ' – ' + fmtDate(c.end_on) : ''),
        link),
      h('span.pill', { class: tone }, label),
      h('div.row', open, editBtn, issue, revoke));
  }

  async function openCert(c) {
    // تُولَّد من القالب والبيانات عند الطلب، فلا يُخزَّن منها ملف
    let full = c;
    try {
      const rows = await db.select('certificates', { select: '*', id: `eq.${c.id}` });
      if (rows && rows[0]) full = rows[0];
    } catch { /* تُرسَم بما في اليد */ }
    // حقولُ صاحبها تُملأ في نصوص القالب الحرّة (ملاحظتا ٣٢٣ و٣٢٤)
    try { full = { ...full, fields: await db.rpc('cert_fields', { p_cert: c.id }) || {} }; }
    catch { /* تُرسَم بلا حقول */ }
    if (!printCertificate(full, c.member_name || nameOf(full.member_id))) {
      toast('امنع حجبَ النوافذ لتُفتح الشهادة.', 'bad');
    }
  }

  // -------------------------------------------------------------
  // الإنشاءُ والتعديل: ويُسأل أوّلًا أهي دورةٌ على المنصة أم خارجها
  // -------------------------------------------------------------
  async function edit(c) {
    const cur = c || {};
    let plans = [];
    try { plans = await db.select('training_plans', { select: 'id,title', order: 'created_at.desc' }) || []; }
    catch { /* لا خططَ محمَّلة */ }

    const kind = h('select', { 'aria-label': 'نوع الشهادة' },
      h('option', { value: 'course', selected: cur.kind !== 'experience' }, 'شهادةُ دورةٍ تدريبية'),
      h('option', { value: 'experience', selected: cur.kind === 'experience' }, 'شهادةُ خبرة'));
    const member = h('select', { 'aria-label': 'العضو' },
      h('option', { value: '' }, '— اختر العضو —'),
      members.map(m => h('option', { value: m.id, selected: cur.member_id === m.id }, m.full_name)));
    const source = h('select', { 'aria-label': 'مصدر الدورة' },
      h('option', { value: 'platform', selected: cur.source !== 'external' }, 'دورةٌ على المنصة'),
      h('option', { value: 'external', selected: cur.source === 'external' }, 'دورةٌ خارج المنصة'));
    const plan = h('select', { 'aria-label': 'الدورة على المنصة' },
      h('option', { value: '' }, '— اختر الدورة —'),
      plans.map(p => h('option', { value: p.id, selected: cur.plan_id === p.id }, p.title)));

    const f = {
      title:    h('input', { value: cur.title || '', 'aria-label': 'العنوان' }),
      subject:  h('input', { value: cur.subject || '', 'aria-label': 'الموضوع' }),
      hours:    h('input', { type: 'number', min: '0', step: '0.5', value: cur.hours ?? '', 'aria-label': 'المدة بالساعات' }),
      start_on: h('input', { type: 'date', value: cur.start_on || '', 'aria-label': 'من' }),
      end_on:   h('input', { type: 'date', value: cur.end_on || '', 'aria-label': 'إلى' }),
      place:    h('input', { value: cur.place || '', 'aria-label': 'المكان' }),
      provider: h('input', { value: cur.provider || '', 'aria-label': 'الجهة المنفّذة' }),
      role_text: h('input', { value: cur.role_text || '', 'aria-label': 'الدور' }),
      body:     h('textarea', { rows: 3, 'aria-label': 'ما باشره' }, cur.body || '')
    };

    // القالبُ المحفوظُ هو الأصل، وما في الشهادة يعلوه (ملاحظة ٣١٢)
    const d = { ...(tpl || {}), ...(cur.design || {}) };
    const theme = h('select', { 'aria-label': 'القالب' },
      Object.entries(CERT_THEMES).map(([k, v]) =>
        h('option', { value: k, selected: (d.theme || 'classic') === k }, v.name)));
    const landscape = h('input', { type: 'checkbox', checked: d.landscape !== false ? true : null,
      'aria-label': 'أفقي' });
    const signer = h('input', { value: cur.signer_name || '', 'aria-label': 'اسم الموقِّع',
      placeholder: 'يُكتب عند كلِّ شهادة' });
    const signerRole = h('input', { value: cur.signer_role || '', 'aria-label': 'منصب الموقِّع',
      placeholder: 'يُكتب عند كلِّ شهادة' });
    const sign = h('select', { 'aria-label': 'التوقيع' },
      h('option', { value: 'blank', selected: (cur.signature || 'blank') === 'blank' },
        'فراغٌ يُوقَّع عليه باليد بعد الطباعة'),
      h('option', { value: 'image', selected: cur.signature === 'image' }, 'صورةُ توقيعٍ تُدرَج'),
      h('option', { value: 'none', selected: cur.signature === 'none' }, 'بلا توقيعٍ — اكتفاءً بالباركود'));
    const signSrc = h('input', { value: d.signature_src || '', 'aria-label': 'رابط صورة التوقيع',
      placeholder: 'عنوانُ صورة التوقيع' });

    // رفعُ التوقيع صورةً بدل كتابة عنوانها (ملاحظتا ٢٨٢ و٢٨٣)
    const signFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
      'aria-label': 'ملفُّ التوقيع' });
    const signUp = h('button.btn.xs', { type: 'button' }, '⤒ ارفع صورةَ التوقيع');
    const signPrev = h('div.mark-prev');
    const drawSignPrev = () => fill(signPrev, signSrc.value.trim()
      ? h('img', { src: signSrc.value.trim(), alt: 'التوقيع' }) : null);
    signUp.onclick = () => signFile.click();
    signFile.onchange = async () => {
      const file = signFile.files?.[0]; if (!file) return;
      try { signSrc.value = await prepareMark(file, 500); drawSignPrev(); sign.value = 'image'; }
      catch (e) { toast(e.message, 'bad'); }
      signFile.value = '';
    };
    drawSignPrev();

    // العلامةُ المائية: شعارُ الهيئة شفّافًا في الوسط (ملاحظة ٢٨٢)
    const wmOn = h('input', { type: 'checkbox', checked: d.watermark === false ? null : true,
      'aria-label': 'علامة مائية' });
    const wmSize = h('input', { type: 'range', min: '20', max: '90', step: '5',
      value: String(d.wm_size || 55), 'aria-label': 'حجمُ العلامة' });
    const wmOp = h('input', { type: 'range', min: '2', max: '30', step: '1',
      value: String(Math.round((d.wm_opacity || 0.07) * 100)), 'aria-label': 'شفافيةُ العلامة' });

    // شعاراتٌ تُضاف وتُحرَّك بحرية (ملاحظة ٢٨٢)
    let marks = Array.isArray(d.logos) ? d.logos.map(x => ({ ...x })) : [];
    const markBox = h('div.stack');
    const markFile = h('input', { type: 'file', accept: 'image/*', hidden: true,
      'aria-label': 'ملفُّ الشعار' });
    const markAdd = h('button.btn.xs', { type: 'button' }, '＋ أضِف شعارًا');
    markAdd.onclick = () => markFile.click();
    markFile.onchange = async () => {
      const file = markFile.files?.[0]; if (!file) return;
      try { marks.push({ src: await prepareMark(file, 500), x: 8, y: 8, h: 14 }); drawMarks(); }
      catch (e) { toast(e.message, 'bad'); }
      markFile.value = '';
    };
    const num = (m, key, label, min, max) => {
      const i = h('input', { type: 'number', value: String(m[key]), min: String(min),
        max: String(max), 'aria-label': label });
      i.oninput = () => { m[key] = Number(i.value); };
      return h('label.field.sm', label, i);
    };
    function drawMarks() {
      markBox.replaceChildren(...(marks.length ? marks.map((m, i) =>
        h('div.row.between.wrap.mark-row',
          h('img.mark-thumb', { src: m.src, alt: '' }),
          h('div.row.wrap', { style: { gap: '6px' } },
            num(m, 'x', 'من اليمين ٪', 0, 95),
            num(m, 'y', 'من الأعلى ٪', 0, 95),
            num(m, 'h', 'الارتفاع مم', 5, 60)),
          h('button.btn.xs.ghost', { type: 'button',
            onclick: () => { marks.splice(i, 1); drawMarks(); } }, 'احذفه')))
        : [h('p.small.muted', 'لا شعاراتٍ مضافة — شعارُ الهيئة في رأس الشهادة دائمًا.')]));
    }
    drawMarks();

    const courseBox = h('div.stack');
    const expBox = h('div.stack');
    const syncKind = () => {
      const isCourse = kind.value === 'course';
      courseBox.style.display = isCourse ? '' : 'none';
      expBox.style.display = isCourse ? 'none' : '';
    };
    const syncSource = () => {
      const ext = source.value === 'external';
      plan.closest('label').style.display = ext ? 'none' : '';
      f.provider.closest('label').style.display = ext ? '' : 'none';
    };
    kind.addEventListener('change', syncKind);
    source.addEventListener('change', syncSource);

    fill(courseBox,
      h('label.field', 'أهي دورةٌ على المنصة أم خارجها؟', source),
      h('label.field', 'الدورة على المنصة', plan,
        h('small', 'تُملأ بياناتُها من سجلّها')),
      h('label.field', 'الجهةُ المنفّذة', f.provider),
      h('div.grid-2',
        h('label.field', 'الموضوع', f.subject),
        h('label.field', 'المدّة بالساعات', f.hours),
        h('label.field', 'المكان', f.place)));
    fill(expBox,
      h('label.field', 'الدور الذي قام به', f.role_text),
      h('label.field', 'ما باشره من أعمال', f.body));

    // التواريخُ للنوعين معًا: مدّةُ الدورة، ومدّةُ العمل في الخبرة
    const datesRow = h('div.grid-2',
      h('label.field', 'من', f.start_on),
      h('label.field', 'إلى', f.end_on));

    plan.addEventListener('change', () => {
      const p = plans.find(x => x.id === plan.value);
      if (p && !f.title.value.trim()) f.title.value = p.title;
    });

    const res = await dialog({
      title: c ? 'تعديلُ شهادة' : 'منحُ شهادة',
      body: h('div.stack',
        h('div.grid-2',
          h('label.field', 'النوع', kind),
          h('label.field', 'العضو', member)),
        h('label.field', 'عنوانُ البرنامج أو الشهادة', f.title),
        courseBox, expBox, datesRow,
        h('fieldset.stack', h('legend', 'تصميمُ الشهادة'),
          h('div.grid-2',
            h('label.field', 'القالب', theme),
            h('label.check', landscape, h('span', 'اتّجاهٌ أفقي'))),
          h('div.grid-2',
            h('label.field', 'اسمُ الموقِّع', signer),
            h('label.field', 'المنصب', signerRole)),
          h('p.small.muted', 'الاسمُ والمنصبُ لا يُثبَّتان: يُكتبان عند كلِّ شهادةٍ ويُعدَّلان متى شئت.'),
          h('label.field', 'التوقيع', sign),
          h('div.row.between.wrap',
            h('span.small.muted', 'صورةُ التوقيع'), h('div.row', signUp, signFile)),
          signSrc, signPrev,
          h('fieldset.stack', h('legend', 'العلامةُ المائية'),
            h('label.check', wmOn, h('span', 'شعارُ الهيئة شفّافًا في الوسط')),
            h('div.grid-2',
              h('label.field.sm', 'الحجم', wmSize),
              h('label.field.sm', 'الشفافية', wmOp))),
          h('fieldset.stack', h('legend', 'شعاراتٌ إضافية'),
            h('div.row.between', h('span.small.muted', 'تُرفَع وتُحرَّك بحرّية'),
              h('div.row', markAdd, markFile)),
            markBox))),
      onOpen: () => { syncKind(); syncSource(); },
      buttons: [
        { label: 'حفظ', kind: 'primary',
          validate: () => {
            if (!f.title.value.trim()) { toast('اكتب عنوانَ البرنامج.', 'bad'); return false; }
            if (!member.value) { toast('اختر العضو.', 'bad'); return false; }
            return true;
          },
          value: () => ({
            id: cur.id || null, kind: kind.value, member_id: member.value,
            title: f.title.value.trim(), subject: f.subject.value.trim(),
            hours: f.hours.value || null,
            start_on: f.start_on.value || null, end_on: f.end_on.value || null,
            place: f.place.value.trim(), provider: f.provider.value.trim(),
            source: kind.value === 'course' ? source.value : 'platform',
            plan_id: source.value === 'platform' ? (plan.value || null) : null,
            role_text: f.role_text.value.trim(), body: f.body.value.trim(),
            signer_name: signer.value.trim(), signer_role: signerRole.value.trim(),
            signature: sign.value,
            design: { ...d, theme: theme.value, landscape: landscape.checked,
                      signature_src: signSrc.value.trim() || null,
                      watermark: wmOn.checked,
                      wm_size: Number(wmSize.value), wm_opacity: Number(wmOp.value) / 100,
                      logos: marks }
          }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('save_certificate', { p: res });
      toast(c ? 'حُفظت الشهادة.' : 'أُنشئت الشهادةُ مسوّدةً — تنتظر اعتمادَ مدير المشروع.', 'ok');
      draw();
    } catch (err) { toast(err.message, 'bad'); }
  }

  drawTabs(); draw();
  return page;
}

// شهاداتي: يراها العضو في حسابه
export async function mine() {
  const list = h('div.stack');
  const page = h('div',
    h('div.page-head', h('div', h('p.eyebrow', 'حسابي'), h('h2', 'شهاداتي'))),
    h('div.card.stack', list));

  let rows = [];
  try { rows = await db.rpc('my_certificates') || []; }
  catch (err) { fill(list, h('p.muted', err.message)); return page; }

  if (!rows.length) {
    fill(list, emptyState('لا شهادات', 'لم تصدر لك شهادةٌ بعد.'));
    return page;
  }
  fill(list, rows.map(c => {
    const [label, tone] = STATE[c.status] || STATE.issued;
    const open = h('button.btn.xs.primary', { type: 'button' }, '⤓ الشهادة');
    open.onclick = async () => {
      let full = c;
      try {
        const r = await db.select('certificates', { select: '*', id: `eq.${c.id}` });
        if (r && r[0]) full = r[0];
      } catch { /* تُرسَم بما في اليد */ }
      try { full = { ...full, fields: await db.rpc('cert_fields', { p_cert: c.id }) || {} }; }
      catch { /* تُرسَم بلا حقول */ }
      if (!printCertificate(full, state.profile?.full_name)) {
        toast('امنع حجبَ النوافذ لتُفتح الشهادة.', 'bad');
      }
    };
    return h('div.cert-row',
      h('div', { style: { flex: 1, minWidth: '220px' } },
        h('b', c.title),
        h('div.small.muted', `${KIND_LABEL[c.kind] || ''}${c.hours ? ' · ' + c.hours + ' ساعة' : ''}`),
        c.serial_no ? h('div.small.muted', { dir: 'ltr' }, c.serial_no) : null),
      h('span.pill', { class: tone }, label),
      c.status === 'issued' ? open : null);
  }));
  return page;
}
