// فريق العمل: طلبات التسجيل، التفعيل، الأدوار، واللغات
import { h, fill, toast, busy, dialog, emptyState, fmtDate, fmtDateTime, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager, PERM_LABEL, PERM_KEYS, ROLE_LABEL, STATUS_LABEL,
  TRACK_LABEL, trackOf, CITY, NO_FATWA, langName, stageName } from '../store.js';
import { POLICY_KEY, POLICY_VERSION } from '../policy.js';
import { TEAM_FIELDS, teamRows, exportExcel, exportWord, exportPdf } from '../teamexport.js';
import { nationalitySelect } from '../nationalities.js';

// الفرق مستقلّة: الترجمة التخصصية، والإرشاد المكاني، وإجابة السائلين (ملاحظتا ٩٩ و١٨٦)
export { TRACK_LABEL, trackOf };

// ثلاث قوائم مستقلة تحت «الفريق»: الحسابات الإدارية، والمترجمون المتخصصون،
// والمرشدون المكانيون — لكلٍّ بياناته واعتماداته (ملاحظة ١٠١)
export const GROUP_LABEL = {
  admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون',
  field: 'المرشدون المكانيون', answers: 'المخصَّصون لإجابة السائلين'
};

export async function render(ctx, opts = {}) {
  const group = GROUP_LABEL[opts.group] ? opts.group : (opts.track === 'field' ? 'field' : 'translators');
  const track = group === 'field' ? 'field' : group === 'answers' ? 'answers' : 'translation';
  const [all, priv, perf, rateSum, signed, bank] = await Promise.all([
    db.select('profiles', { select: '*,member_languages(language_code)', order: 'created_at.desc' }),
    db.select('profile_private', { select: '*' }),
    db.select('member_performance', { select: '*' }).catch(() => []),
    db.select('member_rating_summary', { select: '*' }).catch(() => []),
    db.select('policy_acceptances', { select: 'member_id,policy_version,signed_name,accepted_at', policy_key: `eq.${POLICY_KEY}` }).catch(() => []),
    db.select('bank_accounts', { select: '*' }).catch(() => [])
  ]);
  const bankOf = Object.fromEntries(bank.map(b => [b.member_id, b]));
  const privOf = Object.fromEntries(priv.map(p => [p.id, p]));
  // الطلب الجديد يُصنَّف بالصفة التي تقدّم بها، والعضو المفعَّل بدوره وفريقه
  const belongs = m => {
    if (m.status === 'pending') {
      const as = (privOf[m.id] || {}).applied_as;
      if (group === 'admins') return as === 'coordinator';
      if (group === 'field') return as === 'field' || trackOf(m) === 'field';
      if (group === 'answers') return false;   // لا يُسجَّل فيها أحد (ملاحظة ١٨٦)
      return as !== 'coordinator' && as !== 'field' && trackOf(m) !== 'field';
    }
    // وحساب مشرف الهيئة يُدار مع الحسابات الإدارية (ملاحظة ١٤٦)
    if (group === 'admins') return ['manager', 'coordinator', 'supervisor'].includes(m.role);
    if (group === 'field') return trackOf(m) === 'field';
    if (group === 'answers') return trackOf(m) === 'answers';
    return m.role === 'translator' && trackOf(m) === 'translation';
  };
  const members = all.filter(belongs);
  const perfOf = Object.fromEntries(perf.map(r => [r.member_id, r]));
  const rateOf = Object.fromEntries(rateSum.map(r => [r.member_id, r]));
  const signOf = {};
  for (const r of signed) if (r.policy_version === POLICY_VERSION) signOf[r.member_id] = r;

  const stars = n => h('span.stars', { title: n ? `${n} من ٥` : 'بلا تقييم' },
    [1, 2, 3, 4, 5].map(i => h('b', { class: i <= Math.round(n || 0) ? '' : 'off' }, '★')));
  const hours = sec => {
    const s = Math.max(0, Number(sec) || 0);
    if (s < 3600) return `${Math.round(s / 60)} دقيقة`;
    return `${(s / 3600).toFixed(1)} ساعة`;
  };
  const onTimePct = r => (r && r.done_stages) ? Math.round((r.on_time_stages / r.done_stages) * 100) : null;
  const langsOf = m => (m.member_languages || []).map(x => x.language_code);
  const reload = () => ctx.navigate(opts.reloadPath || '/app/team', { replace: true });

  const filterLang = h('select', { 'aria-label': 'تصفية حسب اللغة' }, h('option', { value: '' }, 'جميع اللغات'),
    state.languages.map(l => h('option', { value: l.code }, l.name_ar)));
  const filterStatus = h('select', { 'aria-label': 'تصفية حسب الحالة' }, h('option', { value: '' }, 'كل الحالات'),
    Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const q = h('input', { type: 'search', placeholder: 'الاسم أو البريد', 'aria-label': 'بحث' });
  const table = h('div');

  const canManage = m => isManager() || m.role === 'translator';
  // الصفة التي تقدّم بها العضو عند التسجيل — إفصاح للاسترشاد لا صلاحية (ملاحظة ٦٣)
  const APPLIED_LABEL = { translator: 'مترجم أو مراجع', coordinator: 'منسق أو إداري', field: 'مترجم ميداني — إرشاد مكاني' };

  // حال بيانات العضو: علامةٌ في صفّه، ونافذةُ تدقيقٍ للمنسق (ملاحظة ١٧٩)
  const DATA_BADGE = {
    incomplete: ['warn', 'بياناته ناقصة'],
    submitted: ['gold', 'بيانات للتدقيق'],
    returned: ['bad', 'بيانات أُعيدت'],
    accepted: null
  };
  const dataBadge = m => {
    const st = (privOf[m.id] || {}).data_status || 'incomplete';
    const b = DATA_BADGE[st];
    if (!b || m.status === 'pending') return null;
    return h('span.badge', { class: b[0], title: 'بيانات العضو التي يستكملها بعد التفعيل' }, b[1]);
  };

  async function reviewData(m) {
    const missing = await db.rpc('profile_missing', { p_id: m.id }).catch(() => []);
    const note = h('textarea', { rows: 2, 'aria-label': 'ما ينقص العضو',
      placeholder: 'ما يلزمه استدراكه — يُرسَل إليه' });
    const res = await dialog({
      title: `تدقيق بيانات ${m.full_name}`,
      body: h('div.stack',
        h('p.small.muted', 'رفع العضو بياناته بعد التفعيل. راجعها في ملفه، '
          + 'ثم اقبلها أو أعدها إليه ببيان ما ينقص.'),
        (missing || []).length
          ? h('div.card.stack', h('b.small', 'ما زال ناقصًا عندنا'),
              h('ul.small.tight', missing.map(x => h('li', x))))
          : h('p.small.ok', 'لا ينقصها شيء من البيانات اللازمة.'),
        h('label.field', 'ملاحظة الإعادة', h('small', 'تلزم إن أعدتها، وتُترك إن قبلتها'), note)),
      buttons: [
        { label: 'قبول البيانات', kind: 'primary', value: () => ({ accept: true }) },
        { label: 'إعادتها بملاحظة', kind: 'danger',
          validate: () => (note.value.trim() ? true : 'اكتب ما ينقص العضو ليستدركه'),
          value: () => ({ accept: false, note: note.value.trim() }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('review_profile_data', { p_id: m.id, p_accept: res.accept, p_note: res.note || null });
      toast(res.accept ? 'قُبلت بيانات العضو.' : 'أُعيدت إليه بملاحظتك.', 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function edit(m) {
    const role = h('select', { disabled: !isManager() || m.id === state.profile.id },
      Object.entries(ROLE_LABEL).map(([k, v]) => h('option', { value: k, selected: m.role === k }, v)));
    // نقل العضو بين الفريقين: ترقية المتميّز من الإرشاد إلى الترجمة (ملاحظة ٩٩)
    const trackSel = h('select', { 'aria-label': 'الفريق' },
      Object.entries(TRACK_LABEL).map(([k, v]) => h('option', { value: k, selected: trackOf(m) === k }, v)));

    // المتميّز من المرشدين المكانيين تُسنَد إليه الترجمة بلغته (ملاحظة ١٧٣)
    const mayBox = h('input', { type: 'checkbox', checked: m.may_translate ? true : null,
      'aria-label': 'يترجم بلغته المسجَّلة' });
    const mayCard = h('fieldset.stack', { style: { display: trackOf(m) === 'field' ? '' : 'none' } },
      h('legend', 'المرشد المتميّز'),
      h('label.check', mayBox, h('span', 'تُسنَد إليه أعمال ترجمة بلغته المسجَّلة')),
      h('p.small.muted', 'الأصل في فريق الإرشاد المكاني ألّا تُسنَد إليه ترجمة. '
        + 'وهذا استثناءٌ للمتميّز، ولا يتجاوز لغاته المسجَّلة أعلاه. '
        + 'ولا تُرفع الإتاحة وفي يده عملٌ لم يُنجز.'));
    // مدينة المرشد: عليها تُبنى دعوات التدريب والاجتماعات (ملاحظة ١٨٥)
    const citySel = h('select', { 'aria-label': 'مدينة العمل' },
      h('option', { value: '' }, '— غير محدَّدة —'),
      Object.entries(CITY).map(([k, v]) => h('option', { value: k, selected: m.city === k }, v)));
    const cityCard = h('fieldset.stack', { style: { display: trackOf(m) === 'field' ? '' : 'none' } },
      h('legend', 'مدينة العمل'),
      h('label.field', 'المسجد الذي يرشد فيه', citySel),
      h('p.small.muted', 'تُبنى عليها دعواته: فاجتماعُ مكة لأهل مكة، واجتماعُ المدينة لأهلها.'));

    // وفريق إجابة السائلين: لا فتوى لأحدٍ البتّة (ملاحظة ١٨٦)
    const answersCard = h('fieldset.stack', { style: { display: trackOf(m) === 'answers' ? '' : 'none' } },
      h('legend', 'إجابة السائلين'),
      h('p.small', NO_FATWA),
      h('p.small.muted', 'ولا يُسجَّل في هذه القائمة أحد ابتداءً: إنما يُنقل إليها من هنا.'));

    trackSel.addEventListener('change', () => {
      mayCard.style.display = trackSel.value === 'field' ? '' : 'none';
      cityCard.style.display = trackSel.value === 'field' ? '' : 'none';
      answersCard.style.display = trackSel.value === 'answers' ? '' : 'none';
      if (trackSel.value !== 'field') mayBox.checked = false;
    });

    // إلزام هذا الحساب بالتحقق بخطوتين — لمدير المشروع (ملاحظة ١٧١)
    const mfaBox = h('input', { type: 'checkbox', checked: m.mfa_required ? true : null,
      disabled: !isManager() || null, 'aria-label': 'إلزام التحقق بخطوتين' });
    const mfaCard = h('fieldset.stack',
      h('legend', 'التحقق بخطوتين'),
      h('label.check', mfaBox, h('span', 'يُلزَم هذا الحساب بالتحقق بخطوتين')),
      h('p.small.muted', isManager()
        ? 'من أُلزم لا يدخل حتى يفعّله بتطبيق المصادقة على جوّاله. والتفعيل بيده هو، '
          + 'فلا يملكه أحدٌ عنه.'
        : 'الإلزام بيد مدير المشروع.'));

    // قائمة صلاحيات الحساب الإداري — لمدير المشروع (ملاحظة ١٧٢)
    const permBoxes = new Map();
    const permCard = h('fieldset.stack', { style: { display: ['coordinator', 'supervisor'].includes(m.role) ? '' : 'none' } },
      h('legend', 'صلاحيات الحساب'),
      h('p.small.muted', 'الأصل أن تكون كلها مفتوحة. وما تُغلقه هنا يُحجب من القائمة، '
        + 'ويُمنع في قاعدة البيانات لا في الشاشة وحدها.'),
      h('div.perm-grid', PERM_KEYS.map(k => {
        const cb = h('input', { type: 'checkbox', checked: m.perms?.[k] === false ? null : true,
          disabled: !isManager() || null, 'aria-label': PERM_LABEL[k] });
        permBoxes.set(k, cb);
        return h('label.check', cb, h('span', PERM_LABEL[k]));
      })),
      isManager() ? h('div.row',
        h('button.btn.xs', { type: 'button', onclick: () => permBoxes.forEach(c => { c.checked = true; }) }, 'فتح الكل'),
        h('button.btn.xs', { type: 'button', onclick: () => permBoxes.forEach(c => { c.checked = false; }) }, 'إغلاق الكل'))
        : h('p.small.muted', 'ضبط الصلاحيات بيد مدير المشروع.'));
    role.addEventListener('change', () => {
      permCard.style.display = ['coordinator', 'supervisor'].includes(role.value) ? '' : 'none';
    });

    // اللغات من قائمة منسدلة مع رقائق تُحذف بضغطة (ملاحظة ٥٢)
    const chosen = new Set(langsOf(m));
    const langSelect = h('select', { 'aria-label': 'أضف لغة' });
    const langChips = h('div.lang-pills.chosen');
    function drawLangs() {
      const rest = state.languages.filter(l => l.is_active && !chosen.has(l.code));
      fill(langSelect, h('option', { value: '' }, rest.length ? '— أضف لغة —' : '— أُضيفت كل اللغات —'),
        rest.map(l => h('option', { value: l.code }, l.name_ar)));
      langChips.replaceChildren(...[...chosen].map(code => h('button', { type: 'button', 'aria-pressed': 'true',
        'aria-label': `إزالة ${langName(code)}`, title: 'إزالة اللغة',
        onclick: () => { chosen.delete(code); drawLangs(); } },
        h('span.tick', { 'aria-hidden': 'true' }, '✓'), langName(code), h('span.x', { 'aria-hidden': 'true' }, '×'))));
      if (!chosen.size) langChips.append(h('span.small.muted', 'لا لغات'));
    }
    langSelect.addEventListener('change', () => { if (langSelect.value) { chosen.add(langSelect.value); drawLangs(); } });
    drawLangs();

    // بيانات التواصل قابلة للتعديل من المنسق ومدير المشروع (ملاحظة ٥٢)
    const p = privOf[m.id] || {};
    const fld = {
      full_name: h('input', { value: m.full_name || '' }),
      whatsapp: h('input', { dir: 'ltr', value: p.whatsapp || '', placeholder: '+9665XXXXXXXX' }),
      nationality: nationalitySelect(h, p.nationality),
      national_id: h('input', { dir: 'ltr', maxlength: 15, value: p.national_id || '', placeholder: '1XXXXXXXXX' }),
      id_type: h('select',
        h('option', { value: 'national' }, 'هوية وطنية أو إقامة'),
        h('option', { value: 'passport' }, 'جواز سفر')),
      residence: h('input', { value: p.residence || '' })
    };
    fld.id_type.value = p.id_type || 'national';

    const iqama = h('div.stack', { style: { gap: '8px' } });
    const drawIqama = () => {
      const view = h('div');
      if (p.iqama_path) storage.signedUrl('private-docs', p.iqama_path, 600)
        .then(url => view.replaceChildren(h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, 'عرض صورة الهوية (رابط مؤقت ١٠ دقائق)')))
        .catch(() => view.replaceChildren(h('span.small.muted', 'تعذّر فتح الصورة')));
      else view.replaceChildren(h('span.small.muted', 'لم تُرفع صورة الهوية بعد'));
      const up = h('input', { type: 'file', accept: 'image/*,application/pdf', 'aria-label': 'رفع صورة الهوية' });
      up.onchange = () => busy(up, async () => {
        const file = up.files[0]; if (!file) return;
        try {
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = `${m.id}/iqama-${Date.now()}.${ext}`;
          await storage.upload('private-docs', path, file);
          await db.rpc('admin_set_iqama', { p_member: m.id, p_path: path });
          p.iqama_path = path; drawIqama(); toast('رُفعت صورة الهوية.', 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      });
      iqama.replaceChildren(view, h('label.field', 'رفع صورة الهوية أو الإقامة', up));
    };
    drawIqama();

    const result = await dialog({
      title: `${m.full_name} — ${ROLE_LABEL[m.role]}`,
      body: h('div.stack',
        h('div.grid-2',
          h('div', h('div.small.muted', 'البريد'), h('div', { dir: 'ltr' }, m.email)),
          h('div', h('div.small.muted', 'تاريخ التسجيل'), h('div', fmtDate(m.created_at))),
          h('div', h('div.small.muted', 'تقدّم بصفة'), h('div', APPLIED_LABEL[p.applied_as] || 'غير محددة'))),
        h('div.grid-2',
          h('label.field', 'الاسم الكامل', fld.full_name),
          h('label.field', 'رقم واتس آب', fld.whatsapp),
          h('label.field', 'الجنسية', fld.nationality),
          h('label.field', 'نوع الهوية', fld.id_type),
          h('label.field', 'رقم الهوية أو الإقامة أو الجواز', fld.national_id),
          h('label.field', 'مكان الإقامة', fld.residence)),
        iqama,
        h('div.grid-2',
          h('label.field', 'الدور', role, !isManager() && h('small', 'تغيير الأدوار الإدارية بيد مدير المشروع')),
          h('label.field', 'الفريق', trackSel,
            h('small', 'ومن هنا يُنقل العضو إلى إجابة السائلين: نقلُ السؤال ونقلُ الجواب، بلا فتوى'))),
        h('fieldset', h('legend', 'اللغات المؤهل فيها'), h('div.stack', { style: { gap: '10px' } }, langSelect, langChips)),
        mayCard, cityCard, answersCard, permCard, mfaCard),
      buttons: [
        { label: 'حفظ', kind: 'primary', validate: () => {
          if (mayBox.checked && trackSel.value === 'field' && !chosen.size) {
            toast('سجّل لغات المرشد أولًا، فالإسناد يكون بحسب لغته.', 'bad'); return false; }
          const nid = fld.national_id.value.trim().toUpperCase();
          if (nid && fld.id_type.value === 'passport' && !/^[A-Z0-9]{5,15}$/.test(nid)) {
            toast('رقم الجواز من خمسة إلى خمسة عشر حرفًا ورقمًا.', 'bad'); return false; }
          if (nid && fld.id_type.value === 'national' && !/^[12][0-9]{9}$/.test(nid)) {
            toast('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ أو ٢.', 'bad'); return false; }
          if (fld.full_name.value.trim().length < 3) { toast('اكتب الاسم الكامل.', 'bad'); return false; }
          return true;
        }, value: () => ({ role: role.value, languages: [...chosen], track: trackSel.value,
          may: mayBox.checked && trackSel.value === 'field',
          city: trackSel.value === 'field' ? (citySel.value || null) : null,
          perms: Object.fromEntries([...permBoxes].filter(([, c]) => !c.checked).map(([k]) => [k, false])),
          contact: { full_name: fld.full_name.value.trim(), whatsapp: fld.whatsapp.value.trim(),
            nationality: fld.nationality.value.trim(), national_id: fld.national_id.value.trim().toUpperCase(),
            id_type: fld.id_type.value, residence: fld.residence.value.trim() } }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!result) return;
    try {
      await db.rpc('admin_update_member', { p_member: m.id, p_status: null, p_role: result.role === m.role ? null : result.role, p_languages: result.languages });
      await db.rpc('admin_update_contact', { p_member: m.id, p_full_name: result.contact.full_name || null,
        p_whatsapp: result.contact.whatsapp || null, p_nationality: result.contact.nationality || null,
        p_national_id: result.contact.national_id || null, p_residence: result.contact.residence || null,
        p_id_type: result.contact.id_type || null });
      if (result.track !== trackOf(m)) {
        await db.rpc('set_member_track', { p_member: m.id, p_track: result.track });
        toast(`نُقل ${m.full_name} إلى ${TRACK_LABEL[result.track]}.`, 'ok');
      }
      // المرشد المتميّز، والصلاحيات، وإلزام التحقق — كلٌّ في موضعه (ملاحظات ١٧١–١٧٣)
      if (result.track === 'field' && result.may !== !!m.may_translate) {
        await db.rpc('set_member_may_translate', { p_member: m.id, p_on: result.may });
      }
      if ((result.city || null) !== (m.city || null)) {
        await db.rpc('set_member_city', { p_member: m.id, p_city: result.city });
      }
      if (isManager() && ['coordinator', 'supervisor'].includes(result.role)) {
        const before = JSON.stringify(m.perms || {});
        if (before !== JSON.stringify(result.perms)) {
          await db.rpc('set_member_perms', { p_member: m.id, p_perms: result.perms });
        }
      }
      if (isManager() && mfaBox.checked !== !!m.mfa_required) {
        await db.rpc('set_member_mfa_required', { p_member: m.id, p_on: mfaBox.checked });
      }
      toast('حُفظت بيانات العضو.', 'ok'); reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ---------------------------------------------------------------
  // إضافة عضو يدويًا — لمدير المشروع وحده (ملاحظة ٦٨)
  // ---------------------------------------------------------------
  async function addMember() {
    const fld = {
      full_name: h('input', { autocomplete: 'off' }),
      email: h('input', { type: 'email', dir: 'ltr', autocomplete: 'off' }),
      password: h('input', { type: 'text', dir: 'ltr', autocomplete: 'off',
        value: 'Haramain-' + Math.random().toString(36).slice(2, 8) }),
      role: h('select', Object.entries(ROLE_LABEL).map(([k, v]) =>
        h('option', { value: k, selected: k === (group === 'admins' ? 'coordinator' : 'translator') ? true : null }, v))),
      whatsapp: h('input', { dir: 'ltr', placeholder: '+9665XXXXXXXX' }),
      nationality: nationalitySelect(h),
      national_id: h('input', { dir: 'ltr', inputmode: 'numeric', maxlength: 10, placeholder: '1XXXXXXXXX' }),
      residence: h('input')
    };
    const chosen = new Set();
    const langSelect = h('select', { 'aria-label': 'أضف لغة' });
    const langChips = h('div.lang-pills.chosen');
    const drawLangs = () => {
      const rest = state.languages.filter(l => l.is_active && !chosen.has(l.code));
      fill(langSelect, h('option', { value: '' }, rest.length ? '— أضف لغة —' : '— أُضيفت كل اللغات —'),
        rest.map(l => h('option', { value: l.code }, l.name_ar)));
      langChips.replaceChildren(...[...chosen].map(code => h('button', { type: 'button', 'aria-pressed': 'true',
        title: 'إزالة اللغة', 'aria-label': `إزالة ${langName(code)}`, onclick: () => { chosen.delete(code); drawLangs(); } },
        h('span.tick', { 'aria-hidden': 'true' }, '✓'), langName(code), h('span.x', { 'aria-hidden': 'true' }, '×'))));
      if (!chosen.size) langChips.append(h('span.small.muted', 'لا لغات'));
    };
    langSelect.addEventListener('change', () => { if (langSelect.value) { chosen.add(langSelect.value); drawLangs(); } });
    drawLangs();

    const res = await dialog({
      title: 'إضافة عضو يدويًا',
      body: h('div.stack',
        h('p.small.muted', 'يُنشأ الحساب مفعّلًا وبريده مؤكَّد. سلّم العضو كلمة المرور المؤقتة وذكّره بتغييرها من «نسيت كلمة المرور».'),
        h('div.grid-2',
          h('label.field', 'الاسم الكامل', fld.full_name),
          h('label.field', 'البريد الإلكتروني', fld.email),
          h('label.field', 'كلمة المرور المؤقتة', fld.password),
          h('label.field', 'الدور', fld.role),
          h('label.field', 'رقم الجوال', fld.whatsapp),
          h('label.field', 'الجنسية', fld.nationality),
          h('label.field', 'رقم الهوية أو الإقامة', fld.national_id),
          h('label.field', 'مكان الإقامة', fld.residence)),
        h('fieldset', h('legend', 'اللغات'), h('div.stack', { style: { gap: '10px' } }, langSelect, langChips))),
      buttons: [
        { label: 'إنشاء الحساب', kind: 'primary', validate: () => {
          if (fld.full_name.value.trim().length < 3) { toast('اكتب الاسم الكامل.', 'bad'); return false; }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fld.email.value.trim())) { toast('البريد الإلكتروني غير صحيح.', 'bad'); return false; }
          if (fld.password.value.length < 8) { toast('كلمة المرور ٨ أحرف على الأقل.', 'bad'); return false; }
          const nid = fld.national_id.value.trim().toUpperCase();
          if (nid && !/^[12][0-9]{9}$/.test(nid)) {
            toast('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ أو ٢.', 'bad'); return false; }
          if (track === 'translation' && fld.role.value === 'translator' && !chosen.size) {
            toast('اختر لغة واحدة على الأقل للمترجم.', 'bad'); return false; }
          return true;
        }, value: () => ({ ...Object.fromEntries(Object.entries(fld).map(([k, el]) => [k, el.value.trim()])), languages: [...chosen] }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      const newId = await db.rpc('admin_create_member', {
        p_email: res.email, p_password: res.password, p_full_name: res.full_name, p_role: res.role,
        p_whatsapp: res.whatsapp || null, p_nationality: res.nationality || null,
        p_national_id: res.national_id || null, p_residence: res.residence || null,
        p_languages: res.languages.length ? res.languages : null
      });
      // الحساب يُفتح في الفريق المعروض على الشاشة (ملاحظة ٩٩)
      if (track === 'field' && newId) {
        await db.rpc('set_member_track', { p_member: String(newId).replace(/"/g, ''), p_track: 'field' });
      }
      toast(`أُنشئ حساب ${res.full_name}. كلمة المرور المؤقتة: ${res.password}`, 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ---------------------------------------------------------------
  // تصدير بيانات الفريق: اختيار الأعضاء والحقول والصيغة (ملاحظة ٧٨)
  // ---------------------------------------------------------------
  async function exportTeam() {
    const pool = members.filter(m => m.status !== 'pending');
    const picked = new Set(pool.map(m => m.id));
    const fields = new Set(['full_name', 'role', 'email', 'whatsapp', 'languages']);

    const memberBox = h('div.pick-list');
    const allBox = h('input', { type: 'checkbox', checked: true });
    const drawMembers = () => {
      memberBox.replaceChildren(...pool.map(m => {
        const cb = h('input', { type: 'checkbox', checked: picked.has(m.id) ? true : null });
        cb.onchange = () => { cb.checked ? picked.add(m.id) : picked.delete(m.id); allBox.checked = picked.size === pool.length; count(); };
        return h('label.check', cb, h('span', m.full_name, h('span.small.muted', ` — ${ROLE_LABEL[m.role]}`)));
      }));
    };
    allBox.onchange = () => { picked.clear(); if (allBox.checked) pool.forEach(m => picked.add(m.id)); drawMembers(); count(); };

    const fieldBox = h('div.pick-list', TEAM_FIELDS.map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', checked: fields.has(k) ? true : null });
      cb.onchange = () => { cb.checked ? fields.add(k) : fields.delete(k); count(); };
      return h('label.check', cb, h('span', label));
    }));
    const counter = h('p.small.muted');
    const count = () => { counter.textContent = `المحدد: ${picked.size} عضوًا و${fields.size} حقلًا`; };
    drawMembers(); count();

    // عنوان الكشف وأعمدة إضافية فارغة بأسماء يختارها المستخدم (ملاحظة ٨٠)
    const title = h('input', { value: 'فريق الترجمة', maxlength: 80 });
    const extra = [h('input', { placeholder: 'مثال: التوقيع' }), h('input', { placeholder: 'مثال: التاريخ' }),
      h('input', { placeholder: 'مثال: ملاحظات' })];
    const fmt = h('select', { 'aria-label': 'صيغة الملف' },
      h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
      h('option', { value: 'docx' }, 'Word — مستند'),
      h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));

    const res = await dialog({
      title: 'تصدير بيانات فريق العمل',
      body: h('div.stack',
        h('div.grid-2',
          h('label.field', 'عنوان الكشف', title),
          h('label.field', 'الصيغة', fmt)),
        h('fieldset', h('legend', 'أعمدة إضافية فارغة (اختياري)'),
          h('p.small.muted', 'اكتب اسم العمود ليظهر في الكشف فارغًا للتعبئة باليد — مثل كشف حضور أو استلام.'),
          h('div.grid-2', extra.map((el, i) => h('label.field', `العمود ${i + 1}`, el)))),
        h('div.row', counter),
        h('div.grid-2',
          h('fieldset', h('legend', 'الأعضاء'), h('label.check', allBox, h('b', 'تحديد الكل')), memberBox),
          h('fieldset', h('legend', 'البيانات المطلوبة'), fieldBox))),
      buttons: [
        { label: 'تصدير', kind: 'primary', validate: () => {
          if (!picked.size) { toast('اختر عضوًا واحدًا على الأقل.', 'bad'); return false; }
          if (!fields.size) { toast('اختر حقلًا واحدًا على الأقل.', 'bad'); return false; }
          return true;
        }, value: () => ({ fmt: fmt.value, title: title.value.trim() || 'فريق الترجمة',
          extraColumns: extra.map(el => el.value.trim()).filter(Boolean) }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    const keys = TEAM_FIELDS.map(f => f[0]).filter(k => fields.has(k));
    const rows = teamRows(pool.filter(m => picked.has(m.id)), keys, { privOf, signOf, bankOf, extraColumns: res.extraColumns });
    try {
      if (res.fmt === 'xlsx') exportExcel(rows, res.title);
      else if (res.fmt === 'docx') await exportWord(rows, res.title);
      else if (!exportPdf(rows, res.title)) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ملف الأداء والتقييم — للمنسقين ومدير المشروع فقط (ملاحظة ٥٧)
  async function performance(m) {
    const r = perfOf[m.id] || {};
    const sum = rateOf[m.id] || {};
    const list = h('div.stack', h('p.muted.small', 'جارٍ التحميل…'));

    const drawList = async () => {
      try {
        const rows = await db.select('member_ratings', {
          select: '*,rater:profiles!member_ratings_rater_id_fkey(full_name)',
          member_id: `eq.${m.id}`, order: 'created_at.desc', limit: 50
        });
        list.replaceChildren(rows.length ? h('div.stack', rows.map(x => h('div.row', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '8px' } },
          h('div', { style: { flex: 1, minWidth: '180px' } },
            stars(x.score),
            x.note ? h('div.small', x.note) : h('div.small.muted', 'بلا ملاحظة'),
            h('div.small.muted', `${x.rater?.full_name || '—'} — ${fmtDateTime(x.created_at)}${x.stage_key ? ' — ' + stageName(x.stage_key) : ''}`)),
          (isManager() || x.rater_id === state.profile.id) && h('button.btn.sm.danger', { type: 'button', onclick: async e => {
            if (!await confirm('حذف التقييم', 'يُحذف هذا التقييم نهائيًا. متابعة؟', 'حذف')) return;
            await busy(e.currentTarget, async () => {
              try { await db.rpc('delete_rating', { p_id: x.id }); toast('حُذف التقييم.', 'ok'); drawList(); }
              catch (err) { toast(err.message, 'bad'); }
            });
          } }, 'حذف'))))
          : h('p.muted.small', 'لا تقييمات بعد.'));
      } catch (err) { list.replaceChildren(h('p.small.bad', err.message)); }
    };
    drawList();

    const score = h('select', { 'aria-label': 'الدرجة' },
      [5, 4, 3, 2, 1].map(v => h('option', { value: String(v) }, `${v} — ${['', 'ضعيف', 'مقبول', 'جيد', 'جيد جدًا', 'ممتاز'][v]}`)));
    const note = h('textarea', { rows: 2, placeholder: 'ملاحظة موجزة على الأداء (اختياري)' });
    const add = h('button.btn.sm.primary', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
      try {
        await db.rpc('rate_member', { p_member: m.id, p_score: Number(score.value), p_note: note.value.trim() || null });
        note.value = ''; toast('سُجّل التقييم.', 'ok'); drawList();
      } catch (err) { toast(err.message, 'bad'); }
    }) }, 'إضافة التقييم');

    const pct = onTimePct(r);
    const sg = signOf[m.id];
    await dialog({
      title: `أداء ${m.full_name}`,
      body: h('div.stack',
        h('div.perf-grid',
          h('div', h('div.small.muted', 'مراحل منجزة'), h('div.v', String(r.done_stages ?? 0))),
          h('div', h('div.small.muted', 'الالتزام بالمواعيد'), h('div.v', pct === null ? '—' : pct + '٪')),
          h('div', h('div.small.muted', 'مجموع التأخير'), h('div.v', hours(r.late_seconds))),
          h('div', h('div.small.muted', 'مرات الإعادة'), h('div.v', String(r.redo_rounds ?? 0))),
          h('div', h('div.small.muted', 'مهام مفتوحة'), h('div.v', String(r.open_stages ?? 0))),
          h('div', h('div.small.muted', 'معدل التقييم'), h('div.v', sum.avg_score ? `${sum.avg_score} / 5` : '—'),
            h('div.small.muted', sum.ratings_count ? `${sum.ratings_count} تقييم` : ''))),
        h('p.small.muted', sg
          ? `وقّع ميثاق العمل (نسخة ${sg.policy_version}) باسم «${sg.signed_name}» في ${fmtDateTime(sg.accepted_at)}.`
          : 'لم يوقّع على ميثاق العمل بنسخته الحالية بعد.'),
        h('fieldset', h('legend', 'تقييم جديد'),
          h('div.stack', { style: { gap: '8px' } }, h('label.field', 'الدرجة', score), h('label.field', 'ملاحظة', note), h('div.row', add))),
        h('fieldset', h('legend', 'سجل التقييمات'), list)),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  }

  async function setStatus(btn, m, status) {
    await busy(btn, async () => {
      try {
        await db.rpc('admin_update_member', { p_member: m.id, p_status: status, p_role: null, p_languages: null });
        toast(status === 'active' ? `فُعّل حساب ${m.full_name}.` : `عُطّل حساب ${m.full_name}.`, 'ok'); reload();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  const showPerf = group === 'translators';
  function draw() {
    const list = members.filter(m => m.status !== 'pending')
      .filter(m => !filterLang.value || langsOf(m).includes(filterLang.value))
      .filter(m => !filterStatus.value || m.status === filterStatus.value)
      .filter(m => !q.value.trim() || m.full_name.includes(q.value.trim()) || m.email.includes(q.value.trim()));
    table.replaceChildren(list.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الاسم', 'الدور', 'اللغات', showPerf ? 'التقييم' : 'رقم العضوية', 'السرية', 'الحالة', ''].map(t => h('th', t)))),
      h('tbody', list.map(m => h('tr',
        h('td', { 'data-label': 'الاسم' }, h('b', m.full_name), h('span.sub', { dir: 'ltr' }, m.email)),
        h('td', { 'data-label': 'الدور' }, ROLE_LABEL[m.role]),
        h('td', { 'data-label': 'اللغات' }, langsOf(m).map(langName).join('، ') || '—'),
        showPerf
          ? h('td', { 'data-label': 'التقييم' },
              rateOf[m.id]?.avg_score ? h('span', stars(rateOf[m.id].avg_score), h('span.sub', `${rateOf[m.id].avg_score} / 5`)) : h('span.muted', '—'),
              onTimePct(perfOf[m.id]) === null ? null : h('span.sub', `الالتزام ${onTimePct(perfOf[m.id])}٪ · ${perfOf[m.id].done_stages} مرحلة`))
          : h('td', { 'data-label': 'رقم العضوية', dir: 'ltr' }, m.member_no ?? '—'),
        h('td', { 'data-label': 'السرية' }, signOf[m.id]
          ? h('span.badge.ok', { title: fmtDateTime(signOf[m.id].accepted_at) }, 'موقّعة')
          : h('span.badge.warn', 'لم توقّع')),
        h('td', { 'data-label': 'الحالة' },
          h('span.badge', { class: m.status === 'active' ? 'ok' : 'bad' }, STATUS_LABEL[m.status]),
          m.may_translate ? h('span.badge.gold', { title: 'تُسنَد إليه الترجمة بلغته' }, 'يترجم') : null,
          m.mfa_required ? h('span.badge', { title: 'مُلزَم بالتحقق بخطوتين' }, 'تحقق') : null,
          Object.values(m.perms || {}).some(v => v === false)
            ? h('span.badge.warn', { title: 'بعض الصلاحيات مغلقة' },
                `${Object.values(m.perms).filter(v => v === false).length} مغلقة`) : null,
          dataBadge(m)),
        h('td', canManage(m) && m.id !== state.profile.id && h('div.row',
          (privOf[m.id] || {}).data_status === 'submitted'
            ? h('button.btn.sm.primary', { type: 'button',
                onclick: () => reviewData(m) }, 'تدقيق البيانات') : null,
          showPerf && h('button.btn.sm', { type: 'button', onclick: () => performance(m) }, 'الأداء والتقييم'),
          h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'الملف والتعديل'),
          m.status === 'active'
            ? h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'تعطيل')
            : h('button.btn.sm', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'))))))))
      : emptyState('لا أعضاء مطابقون', 'غيّر عوامل التصفية.'));
  }
  [filterLang, filterStatus, q].forEach(el => el.addEventListener('input', draw));
  draw();

  const pending = members.filter(m => m.status === 'pending');
  const tools = h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
    isManager() && h('button.btn.sm.primary', { type: 'button', onclick: addMember }, '＋ إضافة عضو'),
    h('button.btn.sm', { type: 'button', onclick: exportTeam }, 'تصدير البيانات'));

  const joinsCard = h('div.card', h('h3', `طلبات التسجيل (${pending.length})`),
      pending.length ? h('div.stack', pending.map(m => h('div.row', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '10px' } },
        h('div', { style: { flex: 1, minWidth: '200px' } }, h('b', m.full_name), h('div.small.muted', { dir: 'ltr' }, m.email),
          h('div.small', 'تقدّم بصفة: ', h('b', APPLIED_LABEL[privOf[m.id]?.applied_as] || 'غير محددة')),
          h('div.small', 'اللغات: ', langsOf(m).map(langName).join('، ') || '—')),
        h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'مراجعة الملف'),
        h('button.btn.sm.primary', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'),
        h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'رفض'))))
        : h('p.muted', 'لا توجد طلبات جديدة.'),
      h('p.small.muted', 'رابط التسجيل لمشاركته مع المترجمين: ', h('span', { dir: 'ltr' }, location.origin + '/register')));

  const filtersRow = h('div.grid', { style: { margin: '16px 0' } },
    h('label.field', 'بحث', q), h('label.field', 'اللغة', filterLang), h('label.field', 'الحالة', filterStatus));

  // أجزاء تُركَّب داخل شاشة «شؤون الفريق» الموحّدة (ملاحظة ٩٨)
  if (opts.parts) return { tools, joins: joinsCard, filters: filtersRow, table, pendingCount: pending.length, members, privOf, bankOf, reload, track, group };

  return h('div',
    h('div.page-head', tools,
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'فريق العمل'),
        h('p.muted', 'ينضم الأعضاء عبر صفحة التسجيل، ثم يفعّلهم المنسق. التعطيل يحفظ سجل العضو بدل حذفه، ولا يُعطَّل من لديه مهمة قائمة.'))),
    joinsCard, filtersRow, table);
}
