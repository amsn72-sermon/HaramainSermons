// فريق العمل: طلبات التسجيل، التفعيل، الأدوار، واللغات
import { h, fill, toast, busy, dialog, emptyState, fmtDate, fmtDateTime, confirm, req } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager, ROLE_LABEL, STATUS_LABEL, roleName,
  TRACK_LABEL, trackOf, CITY, NO_FATWA, langName, stageName, roleLabel, ADMIN_TITLE,
  leadScope, can, LEAD_KIND } from '../store.js';
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
    db.select('profiles', { select: '*,member_languages(language_code,assignable,default_stage,priority)', order: 'created_at.desc' }),
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
    if (group === 'admins') return ['manager', 'coordinator', 'supervisor', 'viewer'].includes(m.role);
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
    const role = h('select', { 'aria-label': 'الدور', disabled: !isManager() || m.id === state.profile.id },
      Object.keys(ROLE_LABEL).filter(k => k !== 'viewer' || m.role === 'viewer')
        .map(k => h('option', { value: k, selected: m.role === k }, roleName(k))));

    // صفةُ العمليات: تُكتب على حساب المنسق، وصلاحيتُه لا تتغير بها.
    // ولا تظهر في التسجيل: التحويلُ إليها بيد مدير المشروع (ملاحظة ٢٠٠)
    const titleSel = h('select', { 'aria-label': 'صفة العمليات' },
      h('option', { value: '' }, 'منسق (بلا صفة)'),
      Object.entries(ADMIN_TITLE).map(([k, v]) =>
        h('option', { value: k, selected: m.admin_title === k }, v)));
    // تظهر دائمًا لمدير المشروع — ولو كان العضو غيرَ منسق — فيعلم أنها هنا،
    // وتُقفَل مع بيان سببِ قفلها (ملاحظة ٢٠٢)
    const titleWhy = h('p.small.muted');
    const titleCard = isManager() ? h('fieldset.stack',
      h('legend', 'صفة العمليات'),
      h('p.small.muted', 'تُكتب على حساب المنسق فتظهر في الشاشات وبطاقة العمل، '
        + 'وصلاحيتُه تبقى صلاحيةَ المنسق نفسَها لا تزيد ولا تنقص. ولا تظهر في التسجيل: '
        + 'التحويلُ إليها بيد مدير المشروع وحده.'),
      h('label.field', 'الصفة', titleSel),
      titleWhy) : null;
    // القيادةُ صارت بالأسماء: يُعيَّن القائدُ بصفته، ويُسنَد إليه أعضاؤه
    // بأعيانهم، ولكلِّ عضوٍ قائدٌ واحدٌ لا غير (ملاحظة ٢٢٨)
    const kindSel = h('select', { 'aria-label': 'صفة القيادة' },
      h('option', { value: '' }, '— ليس قائدًا —'),
      h('option', { value: 'field', selected: m.lead_kind === 'field' }, 'قائد فريق ميداني'),
      h('option', { value: 'translation', selected: m.lead_kind === 'translation' }, 'مشرف فريق الترجمة'));
    const kindWhy = h('small.muted');
    const leadCard = isManager() ? h('fieldset.stack',
      h('legend', 'القيادة والإشراف'),
      h('p.small.muted', 'قائدُ الفريق الميداني يقود المرشدين وإجابةَ السائلين ممن أُسنِدوا إليه '
        + 'بأسمائهم. ومشرفُ فريق الترجمة يُعيَّن من المترجمين الخبراء ويبقى مترجمًا على حاله. '
        + 'ويتعدّد القادةُ، ولكلِّ عضوٍ قائدٌ واحد.'),
      h('label.field', 'صفة القيادة', kindSel, kindWhy)) : null;
    const syncLead = () => {
      if (!leadCard) return;
      const fieldOk = role.value === 'field_lead';
      const trOk = (trackSel?.value || 'translation') === 'translation';
      kindSel.options[1].disabled = !fieldOk;
      kindSel.options[2].disabled = !trOk;
      if ((kindSel.value === 'field' && !fieldOk) || (kindSel.value === 'translation' && !trOk)) {
        kindSel.value = '';
      }
      kindWhy.textContent = !fieldOk && !trOk
        ? 'القيادةُ الميدانيةُ لمن دورُه «قائد فريق ميداني»، والإشرافُ على الترجمة لمن فريقُه الترجمة.'
        : '';
    };

    // قائدُ هذا العضو — يُختار بالاسم، والنقلُ يُخرجه من فريق الأول من نفسه
    const myLead = h('select', { 'aria-label': 'قائد هذا العضو' },
      h('option', { value: '' }, '— بلا قائد —'));
    const myLeadCard = can('team') ? h('label.field', 'قائد هذا العضو', myLead,
      h('small', 'لكلِّ عضوٍ قائدٌ واحد: ونقلُه إلى قائدٍ يُخرجه من فريق الأول')) : null;
    if (myLeadCard) {
      db.rpc('lead_teams').then(rows => {
        (rows || []).filter(r => r.lead_id !== m.id).forEach(r => myLead.append(
          h('option', { value: r.lead_id, selected: m.lead_id === r.lead_id },
            `${r.lead_name} — ${LEAD_KIND[r.lead_kind] || 'قائد'}`)));
      }).catch(() => {});
    }

    // مدرِّبٌ من خبراء الفريق (ملاحظة ٢٣٢)
    const trainerBox = h('input', { type: 'checkbox', checked: m.is_trainer ? true : null,
      disabled: !can('team') || null, 'aria-label': 'مدرّب' });

    // الدوامُ المرن: خيارٌ يُفعَّل لمن يُراد له وحدَه، والأصلُ الالتزامُ
    // بالوقت والمكان المحدَّدَين له (ملاحظة ٢٦٤ ز)
    const flexBox = h('input', { type: 'checkbox', checked: m.flex_hours ? true : null,
      disabled: !can('sh_flex') || null, 'aria-label': 'دوام مرن' });
    const flexCard = (isManager() || can('sh_flex'))
      ? h('fieldset.stack',
          h('legend', 'الدوام'),
          h('label.check', flexBox, h('span', 'دوامٌ مرن')),
          h('p.small.muted', 'الأصلُ أن يلتزم بالوردية والموقع المحدَّدَين له، فيُحتسب تأخيرُه '
            + 'وانصرافُه المبكر. والدوامُ المرن يُطالبه بإتمام الساعات لا بالساعة المعيَّنة.'))
      : null;

    // المسمّى الوظيفيُّ لحساب المتابعة — يُعدَّل متى شاء المدير (ملاحظة ٢٧١ ط)
    const jobTitle = h('input', { value: m.job_title || '', 'aria-label': 'المسمّى الوظيفي',
      placeholder: 'مدير إدارة اللغات…' });
    const jobCard = (isManager() && m.role === 'viewer')
      ? h('label.field', 'المسمّى الوظيفي', jobTitle,
          h('small', 'هو الذي يظهر في المنصة مكان الدور، ويُعدَّل متى شئت'))
      : null;

    const syncTitle = () => {
      if (!titleCard) return;
      const ok = role.value === 'coordinator';
      titleSel.disabled = !ok;
      titleWhy.textContent = ok ? '' : 'الصفة للمنسقين: حوّل «الدور» إلى منسق لتُفتح.';
    };
    syncTitle();
    role.addEventListener('change', syncTitle);
    // نقل العضو بين الفريقين: ترقية المتميّز من الإرشاد إلى الترجمة (ملاحظة ٩٩)
    const trackSel = h('select', { 'aria-label': 'الفريق' },
      Object.entries(TRACK_LABEL).map(([k, v]) => h('option', { value: k, selected: trackOf(m) === k }, v)));

    // صفةُ القيادة تتبع الدورَ والفريق، فتُراجَع كلما تبدّل أحدُهما
    syncLead();
    role.addEventListener('change', syncLead);
    trackSel.addEventListener('change', syncLead);

    // «يترجم»: خيارٌ أمام كل عضوٍ من الفريق كائنًا ما كان مسلكُه — فمن
    // حُدِّد له ظهر في قائمة الإسناد للغته التي يتحدث بها (ملاحظة ٢٠٦)
    const mayBox = h('input', { type: 'checkbox', checked: m.may_translate ? true : null,
      'aria-label': 'يترجم' });
    const mayWhy = h('p.small.muted');
    const mayCard = h('fieldset.stack',
      h('legend', 'يترجم'),
      h('label.check', mayBox, h('span', 'يظهر في قائمة الإسناد للغاته المسجَّلة')),
      mayWhy);
    const syncMay = () => {
      mayWhy.textContent = trackSel.value === 'translation'
        ? 'المترجم المتخصص يترجم بحكم دوره. وإن رفعتَ التحديد لم يظهر في قائمة '
          + 'الإسناد ولم تُسنَد إليه مرحلةٌ جديدة — كمن غاب أو انقطع. ولا يُرفع '
          + 'وفي يده عملٌ لم يُنجز.'
        : trackSel.value === 'answers'
          ? 'الأصل في فريق إجابة السائلين ألّا تُسنَد إليه ترجمة. فإن حدَّدتَه '
            + 'ظهر في الإسناد، ولا يتجاوز لغاته المسجَّلة أعلاه.'
          : 'الأصل في فريق الإرشاد المكاني ألّا تُسنَد إليه ترجمة. وهذا استثناءٌ '
            + 'للمتميّز، ولا يتجاوز لغاته المسجَّلة أعلاه. ولا تُرفع الإتاحة وفي '
            + 'يده عملٌ لم يُنجز.';
    };
    // مدينة المرشد: عليها تُبنى دعوات التدريب والاجتماعات (ملاحظة ١٨٥)
    const citySel = h('select', { 'aria-label': 'مدينة العمل' },
      h('option', { value: '' }, '— غير محدَّدة —'),
      Object.entries(CITY).map(([k, v]) => h('option', { value: k, selected: m.city === k }, v)));
    // تُطلب من الجميع: ففي المترجمين المتخصصين من يعمل عن بُعد (ملاحظة ٢٢٢)
    const cityCard = h('fieldset.stack',
      h('legend', 'مدينة العمل'),
      h('label.field', 'الحرم الذي يعمل فيه', citySel),
      h('p.small.muted', 'تُسأل من كل عضو: المرشدون وإجابةُ السائلين في مكة والمدينة، '
        + 'والمترجمون المتخصصون أصلُهم مكة وفيهم من يعمل عن بُعد. '
        + 'وعليها تُبنى دعواتُه ونطاقُ حضوره: فاجتماعُ مكة لأهل مكة، واجتماعُ المدينة لأهلها.'));

    // وفريق إجابة السائلين: لا فتوى لأحدٍ البتّة (ملاحظة ١٨٦)
    const answersCard = h('fieldset.stack', { style: { display: trackOf(m) === 'answers' ? '' : 'none' } },
      h('legend', 'إجابة السائلين'),
      h('p.small', NO_FATWA),
      h('p.small.muted', 'ولا يُسجَّل في هذه القائمة أحد ابتداءً: إنما يُنقل إليها من هنا.'));

    syncMay();
    trackSel.addEventListener('change', () => {
      answersCard.style.display = trackSel.value === 'answers' ? '' : 'none';
      // من نُقل إلى الترجمة يترجم بحكم دوره، فتُحدَّد له من نفسها
      if (trackSel.value === 'translation' && trackOf(m) !== 'translation') mayBox.checked = true;
      syncMay();
    });

    // إلزام هذا الحساب بالتحقق بخطوتين — لمدير المشروع (ملاحظة ١٧١)
    const mfaBox = h('input', { type: 'checkbox', checked: m.mfa_required ? true : null,
      disabled: !isManager() || null, 'aria-label': 'إلزام التحقق بخطوتين' });
    // الإلغاءُ حلًّا جذريًّا: تسقط العواملُ كلُّها ورموزُ الاسترداد وعلاماتُ
    // الجلسات، ويُعفى الحسابُ صراحةً فيدخل بكلمة المرور وحدها، حتى يُعاد
    // إلزامُه بالمربّع أعلاه (ملاحظة ٢٢٤). وخطوتان قبل التنفيذ.
    const MFA_OFF = 'ألغِ التحقق بخطوتين';
    const clearMsg = h('p.small.muted');
    const clearBtn = h('button.btn.sm.danger', { type: 'button' }, MFA_OFF);
    const mfaStateBox = h('p.small');
    const drawMfaState = (exempt, required) => {
      mfaStateBox.className = exempt ? 'small warn' : 'small muted';
      mfaStateBox.textContent = exempt
        ? 'حالُ الحساب: معفًى — يدخل بكلمة المرور وحدها.'
        : required ? 'حالُ الحساب: مُلزَم بالتحقق بخطوتين.'
                   : 'حالُ الحساب: على الأصل — يتبع الإلزام العام.';
    };
    drawMfaState(m.mfa_exempt === true, m.mfa_required === true);
    let armed = false;
    clearBtn.onclick = async () => {
      if (!armed) {
        armed = true;
        clearBtn.textContent = 'اضغط مرةً أخرى للتأكيد';
        clearMsg.textContent = 'سيسقط كلُّ أثرٍ للتحقق: تسجيلُ التطبيق ورموزُ الاسترداد '
          + 'وعلاماتُ الجلسات، ويُعفى الحسابُ فيدخل بكلمة المرور وحدها. '
          + 'وكلمةُ المرور لا تتغيّر.';
        setTimeout(() => { armed = false; clearBtn.textContent = MFA_OFF; }, 6000);
        return;
      }
      armed = false; clearBtn.disabled = true;
      try {
        await db.rpc('admin_clear_mfa', { p_member: m.id });
        m.mfa_exempt = true; m.mfa_required = false;
        mfaBox.checked = false;
        drawMfaState(true, false);
        clearBtn.textContent = 'أُلغي التحقق';
        clearMsg.textContent = 'أُلغي التحقق وأُعفي الحساب. يدخل الآن بكلمة المرور وحدها، '
          + 'ومتى أردتَ إعادتَه فعلّم «يُلزَم هذا الحساب» واحفظ.';
        toast('أُلغي التحقق بخطوتين لهذا العضو.', 'ok');
      } catch (e) {
        clearBtn.disabled = false; clearBtn.textContent = MFA_OFF;
        toast(e.message, 'bad');
      }
    };

    const mfaCard = h('fieldset.stack',
      h('legend', 'التحقق بخطوتين'),
      mfaStateBox,
      h('label.check', mfaBox, h('span', 'يُلزَم هذا الحساب بالتحقق بخطوتين')),
      h('p.small.muted', isManager()
        ? 'التفعيلُ والإلغاءُ من هنا لا من حساب العضو. ومن أُلزم لا يدخل حتى يسجّل تطبيق '
          + 'المصادقة على جوّاله، فلا يملكه أحدٌ عنه. وللحساب ثلاثُ حالات: مُلزَمٌ، '
          + 'ومعفًى، وعلى الأصل يتبع الإلزام العام.'
        : 'الإلزام بيد مدير المشروع.'),
      can('team') ? h('div.row', clearBtn) : null,
      can('team') ? clearMsg : null,
      can('team') ? h('p.small.muted', 'وزرُّ الإلغاء حلٌّ جذريٌّ لأيِّ عطلٍ يقع: '
        + 'يُسقط كلَّ أثرٍ للتحقق ويفتح الحساب، ثم يُعاد إلزامُه متى شئت فيسجّل من جديد.') : null);

    // ---------------------------------------------------------------
    // لوحةُ الصلاحيات المفصَّلة — لمدير المشروع وحدَه (ملاحظة ٢٦٦)
    //
    //   سبعٌ وأربعون صلاحيةً في عشر وحدات، لكلٍّ أصلُها. وما يُغيَّر
    //   هنا يُمنع في قاعدة البيانات لا في الشاشة وحدَها، ولا يرى
    //   العضوُ لوحتَه هذه. ولوحةُ الصلاحيات نفسُها لا تُمنح لأحد.
    // ---------------------------------------------------------------
    const PERMED = ['coordinator', 'supervisor', 'field_lead', 'viewer'];
    const permWant = new Map();          // المفتاح ← true | false | null (أصلُه)
    const permBody = h('div.perm-wrap', h('p.small.muted', 'يُحمَّل…'));
    const permUntil = h('input', { type: 'date', 'aria-label': 'أجل المنح' });
    const permCard = !isManager() ? null
      : h('fieldset.stack', { style: { display: PERMED.includes(m.role) ? '' : 'none' } },
      h('legend', 'صلاحيات الحساب'),
      h('p.small.muted', 'لكلِّ صلاحيةٍ أصلُها: مفتوحةٌ ابتداءً أو مغلقةٌ لا تُنال إلا بمنحك. '
        + 'وما تُغيّره هنا يُحكَم به في قاعدة البيانات لا في الشاشة وحدَها، ولا يرى العضوُ هذه اللوحة.'),
      permBody,
      h('label.field', 'أجلُ ما تمنحه الآن (اختياري)', permUntil,
        h('small', 'يسقط المنحُ عند هذا التاريخ من نفسه، فلا يُنسى مفتوحًا')));

    const PERM_STATE = { yes: ['مُنح', 'ok'], no: ['مُنع', 'bad'] };
    async function drawPerms() {
      let rows = [];
      try { rows = await db.rpc('member_perm_sheet', { p_member: m.id }) || []; }
      catch { permBody.replaceChildren(h('p.small.muted', 'تعذّر تحميل الصلاحيات.')); return; }
      permWant.clear();
      const groups = new Map();
      for (const r of rows) {
        if (!groups.has(r.grp || 'أخرى')) groups.set(r.grp || 'أخرى', []);
        groups.get(r.grp || 'أخرى').push(r);
      }
      const rowEl = r => {
        const eff = r.setting === null || r.setting === undefined ? r.default_open : r.setting;
        const cb = h('input', { type: 'checkbox', checked: eff ? true : null, 'aria-label': r.label });
        const tag = h('span.perm-tag');
        const paint = () => {
          const want = permWant.has(r.key) ? permWant.get(r.key) : (r.setting ?? null);
          if (want === null) {
            tag.className = 'perm-tag muted';
            tag.textContent = r.default_open ? 'أصلُه مفتوح' : 'أصلُه مغلق';
          } else {
            const [txt, tone] = PERM_STATE[want ? 'yes' : 'no'];
            tag.className = 'perm-tag ' + tone;
            tag.textContent = txt;
          }
        };
        cb.addEventListener('change', () => { permWant.set(r.key, cb.checked); paint(); });
        const undo = h('button.btn.xs.ghost', { type: 'button', title: 'العودة إلى الأصل' },
          '↺');
        undo.onclick = () => {
          permWant.set(r.key, null); cb.checked = !!r.default_open; paint();
        };
        paint();
        return h('label.check.perm-row', { class: r.parent ? 'child' : 'head' }, cb,
          h('span.perm-name', r.label,
            r.sensitive ? h('small.warn', ' ⚠ صلاحيةٌ حسّاسة — تُمنح بتقدير') : null),
          tag, undo);
      };
      permBody.replaceChildren(...[...groups].map(([g, list]) =>
        h('div.perm-group', h('h4', g), ...list.map(rowEl))));
    }
    if (permCard) drawPerms();

    async function savePerms() {
      for (const [key, want] of permWant) {
        try {
          await db.rpc('set_member_perm', { p_member: m.id, p_key: key, p_allowed: want,
            p_until: want === true && permUntil.value ? permUntil.value : null, p_reason: null });
        } catch (err) { toast(err.message, 'bad'); }
      }
    }

    role.addEventListener('change', () => {
      if (permCard) permCard.style.display = PERMED.includes(role.value) ? '' : 'none';
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

    // ---------------- اللغة الأمّ ولغات الإسناد (ملاحظتا ٢٤٩ و٢٥٠) ----------------
    //   اللغةُ الأمُّ واحدةٌ وإلزاميّةٌ كالبريد والهوية. واللغاتُ المُتقَنةُ أعلاه
    //   يعلنها العضو. ولغاتُ الإسنادِ تعتمدها الإدارةُ من بينها، ولكلٍّ منها
    //   دورٌ افتراضيٌّ وأولويةٌ في الدور.
    const nativeSel = h('select', { 'aria-label': 'اللغة الأم' },
      h('option', { value: '' }, '— اختر اللغة الأم —'),
      state.languages.map(l => h('option', { value: l.code, selected: m.native_lang === l.code }, l.name_ar)));
    nativeSel.addEventListener('change', () => {
      if (nativeSel.value) { chosen.add(nativeSel.value); drawLangs(); drawRoles(); }
    });

    const mlOf = code => (m.member_languages || []).find(x => x.language_code === code) || {};
    const roleState = new Map();   // رمزُ اللغة ← { assignable, stage, priority }
    const rolesBox = h('div.stack');
    const drawRoles = () => {
      const list = [...chosen];
      if (!list.length) {
        rolesBox.replaceChildren(h('p.small.muted', 'سجّل لغاته أولًا.'));
        return;
      }
      rolesBox.replaceChildren(h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['اللغة', 'يُسنَد إليه فيها', 'الدور الافتراضي', 'الأولوية'].map(t => h('th', t)))),
        h('tbody', list.map(code => {
          const cur = roleState.get(code) || (() => {
            const r = mlOf(code);
            const v = { assignable: r.assignable !== false, stage: r.default_stage || '',
              priority: r.priority ?? 100 };
            roleState.set(code, v);
            return v;
          })();
          const ok = h('input', { type: 'checkbox', checked: cur.assignable ? true : null,
            disabled: adminLangs ? null : true, 'aria-label': `إسناد ${langName(code)}` });
          ok.onchange = () => { cur.assignable = ok.checked; };
          const st = h('select', { disabled: adminLangs ? null : true, 'aria-label': `دور ${langName(code)}` },
            h('option', { value: '' }, '— بلا دورٍ افتراضي —'),
            (state.stages || []).map(sg => h('option',
              { value: sg.key, selected: cur.stage === sg.key }, sg.name_ar)));
          st.onchange = () => { cur.stage = st.value; };
          const pr = h('input', { type: 'number', min: 1, max: 999, value: String(cur.priority),
            disabled: adminLangs ? null : true, style: { maxWidth: '5rem' },
            'aria-label': `أولوية ${langName(code)}` });
          pr.oninput = () => { cur.priority = Number(pr.value) || 100; };
          return h('tr',
            h('td', { 'data-label': 'اللغة' }, h('b', langName(code)),
              m.native_lang === code ? h('span.badge.gold', { style: { marginInlineStart: '6px' } }, 'أمّ') : null),
            h('td', { 'data-label': 'يُسنَد إليه فيها' }, ok),
            h('td', { 'data-label': 'الدور الافتراضي' }, st),
            h('td', { 'data-label': 'الأولوية' }, pr));
        })))));
    };
    const adminLangs = isManager() || state.profile?.role === 'coordinator';
    drawRoles();
    const langsCard = h('fieldset.stack',
      h('legend', 'اللغة الأمّ ولغات الإسناد'),
      h('label.field', req('اللغة الأمّ'), nativeSel,
        h('small', m.native_lang ? 'لسانُه الذي يُترجم به المواد المهمة — وهي واحدةٌ لا غير'
          : 'لم تُحدَّد بعد — يضعها العضوُ من «بياناتي»، ولك أن تضعها له')),
      h('p.small.muted', adminLangs
        ? 'لغاتُ الإسناد تعتمدها الإدارةُ من بين لغاته، ولا يظهر مرشَّحًا إلا فيها. '
          + 'والأولويةُ الأصغرُ تُسنَد أولًا.'
        : 'اعتمادُ لغات الإسناد وضبطُ الأدوار بيد مدير المشروع والمنسّقين.'),
      rolesBox);

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
      title: `${m.full_name} — ${roleLabel(m)}`,
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
          titleCard,
          leadCard,
          myLeadCard,
          h('label.field', 'الفريق', trackSel,
            h('small', 'ومن هنا يُنقل العضو إلى إجابة السائلين: نقلُ السؤال ونقلُ الجواب، بلا فتوى'))),
        jobCard,
        flexCard,
        can('team') ? h('fieldset.stack',
          h('legend', 'التدريب'),
          h('label.check', trainerBox, h('span', 'مدرِّبٌ من خبراء الفريق')),
          h('p.small.muted', 'المدرِّبُ يُعدّ خططَ التدريب ويرفع موادَّه ويُشارِكها، '
            + 'ويُسجّل تأهيلَ من درّبهم.')) : null,
        h('fieldset', h('legend', 'اللغات التي يُتقنها'), h('div.stack', { style: { gap: '10px' } }, langSelect, langChips)),
        langsCard,
        mayCard, cityCard, answersCard, permCard, mfaCard),
      buttons: [
        { label: 'حفظ', kind: 'primary', validate: () => {
          if (mayBox.checked && !chosen.size) {
            toast('سجّل لغات المرشد أولًا، فالإسناد يكون بحسب لغته.', 'bad'); return false; }
          const nid = fld.national_id.value.trim().toUpperCase();
          if (nid && fld.id_type.value === 'passport' && !/^[A-Z0-9]{5,15}$/.test(nid)) {
            toast('رقم الجواز من خمسة إلى خمسة عشر حرفًا ورقمًا.', 'bad'); return false; }
          if (nid && fld.id_type.value === 'national' && !/^[12][0-9]{9}$/.test(nid)) {
            toast('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ أو ٢.', 'bad'); return false; }
          if (fld.full_name.value.trim().length < 3) { toast('اكتب الاسم الكامل.', 'bad'); return false; }
          // تُطلب اللغةُ الأمُّ ولا يُحجب بها حفظُ من سُجّل قبلها: تُنبَّه ثم تُستكمل
          if (!nativeSel.value && m.native_lang) {
            toast('لا تُفرِغ اللغةَ الأمّ — اخترها أو أبقِ ما كان.', 'bad'); return false; }
          return true;
        }, value: () => ({ role: role.value, languages: [...chosen], track: trackSel.value,
          native: nativeSel.value,
          langRoles: [...chosen].map(code => ({ code, ...(roleState.get(code) || {}) })),
          may: mayBox.checked,
          city: citySel.value || null,
          contact: { full_name: fld.full_name.value.trim(), whatsapp: fld.whatsapp.value.trim(),
            nationality: fld.nationality.value.trim(), national_id: fld.national_id.value.trim().toUpperCase(),
            id_type: fld.id_type.value, residence: fld.residence.value.trim() } }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!result) return;
    try {
      await db.rpc('admin_update_member', { p_member: m.id, p_status: null, p_role: result.role === m.role ? null : result.role, p_languages: result.languages });
      // اللغةُ الأمُّ ثم لغاتُ الإسناد وأدوارُها (ملاحظتا ٢٤٩ و٢٥٠)
      if (result.native && result.native !== (m.native_lang || '')) {
        await db.rpc('set_native_lang', { p_member: m.id, p_lang: result.native })
          .catch(e => toast(e.message, 'bad'));
      }
      if (adminLangs) {
        const okLangs = (result.langRoles || []).filter(r => r.assignable).map(r => r.code);
        await db.rpc('set_assignable_langs', { p_member: m.id, p_languages: okLangs })
          .catch(e => toast(e.message, 'bad'));
        for (const r of result.langRoles || []) {
          await db.rpc('set_lang_role', { p_member: m.id, p_lang: r.code,
            p_stage: r.stage || null, p_priority: r.priority ?? 100 }).catch(() => {});
        }
      }
      // وصفةُ القيادة بعد الدور كذلك، ثم قائدُ العضو (ملاحظة ٢٢٨)
      if (isManager()) {
        const wantKind = kindSel.value || null;
        if (wantKind !== (m.lead_kind || null)) {
          await db.rpc('set_lead_kind', { p_member: m.id, p_kind: wantKind })
            .catch(e => toast(e.message, 'bad'));
        }
      }
      if (myLeadCard) {
        const wantLead = myLead.value || null;
        if (wantLead !== (m.lead_id || null)) {
          await db.rpc('set_member_lead', { p_member: m.id, p_lead: wantLead })
            .catch(e => toast(e.message, 'bad'));
        }
        if (!!trainerBox.checked !== !!m.is_trainer) {
          await db.rpc('set_member_trainer', { p_member: m.id, p_on: trainerBox.checked })
            .catch(e => toast(e.message, 'bad'));
        }
      }
      // والصفةُ بعد الدور، فلا تُكتب على غير منسق
      if (isManager()) {
        const want = result.role === 'coordinator' ? (titleSel.value || null) : null;
        if (want !== (m.admin_title || null)) {
          await db.rpc('set_admin_title', { p_member: m.id, p_title: want }).catch(e => toast(e.message, 'bad'));
        }
      }
      await db.rpc('admin_update_contact', { p_member: m.id, p_full_name: result.contact.full_name || null,
        p_whatsapp: result.contact.whatsapp || null, p_nationality: result.contact.nationality || null,
        p_national_id: result.contact.national_id || null, p_residence: result.contact.residence || null,
        p_id_type: result.contact.id_type || null });
      if (result.track !== trackOf(m)) {
        await db.rpc('set_member_track', { p_member: m.id, p_track: result.track });
        toast(`نُقل ${m.full_name} إلى ${TRACK_LABEL[result.track]}.`, 'ok');
      }
      // المرشد المتميّز، والصلاحيات، وإلزام التحقق — كلٌّ في موضعه (ملاحظات ١٧١–١٧٣)
      if (result.may !== !!m.may_translate) {
        await db.rpc('set_member_may_translate', { p_member: m.id, p_on: result.may });
      }
      if ((result.city || null) !== (m.city || null)) {
        await db.rpc('set_member_city', { p_member: m.id, p_city: result.city });
      }
      if (isManager() && permWant.size) await savePerms();
      // الدوامُ المرن، والمسمّى الوظيفيّ (ملاحظتا ٢٦٤ و٢٧١)
      if (flexCard && !!flexBox.checked !== !!m.flex_hours) {
        await db.rpc('set_flex_hours', { p_member: m.id, p_on: flexBox.checked })
          .catch(e => toast(e.message, 'bad'));
      }
      if (jobCard && jobTitle.value.trim() !== (m.job_title || '')) {
        await db.rpc('set_job_title', { p_member: m.id, p_title: jobTitle.value.trim() || null })
          .catch(e => toast(e.message, 'bad'));
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
      role: h('select', Object.keys(ROLE_LABEL).filter(k => k !== 'viewer').map(k => [k, roleName(k)]).map(([k, v]) =>
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
        return h('label.check', cb, h('span', m.full_name, h('span.small.muted', ` — ${roleLabel(m)}`)));
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

  // ---------------------------------------------------------------
  // تحويلُ تسجيلٍ قائمٍ إلى حساب متابعة (ملاحظة ٢٧١ م)
  //
  //   في الهيئة من يَحسُن اطّلاعُه ولا شأنَ له بالعمل. فيُحوَّل تسجيلُه
  //   بمسمّاه الوظيفيِّ الذي يكتبه المدير، ويبقى بريدُه ودخولُه كما
  //   هما، فلا يُكلَّف تسجيلًا جديدًا ولا يُشعَر بردّ.
  // ---------------------------------------------------------------
  async function toViewer(m) {
    const name  = h('input', { value: m.full_name, 'aria-label': 'الاسم' });
    const title = h('input', { placeholder: 'مدير إدارة اللغات، وكيل الرئيس للغات…',
      'aria-label': 'المسمّى الوظيفي' });
    const until = h('input', { type: 'date', 'aria-label': 'أجل الحساب' });
    const res = await dialog({
      title: 'تحويلٌ إلى حساب متابعة',
      body: h('div.stack',
        h('p.small.muted', 'يرى المنصّةَ كما يراها المنسق ولا يملك فيها فعلًا. '
          + 'ويُعرَض بمسمّاه الوظيفيِّ في كلِّ موضع، ويسقط عنه ما سجّل به.'),
        h('label.field', 'الاسم', name),
        h('label.field', 'المسمّى الوظيفي', title,
          h('small', 'هو الذي يظهر في المنصة، ويُعدَّل متى شئت')),
        h('label.field', 'أجلُ الحساب (اختياري)', until,
          h('small', 'ينتهي بنفسه إن كان لغرضٍ مؤقّت'))),
      buttons: [
        { label: 'تحويل', kind: 'primary',
          validate: () => {
            if (!title.value.trim()) { toast('اكتب المسمّى الوظيفي.', 'bad'); return false; }
            return true;
          },
          value: () => ({ title: title.value.trim(), name: name.value.trim(), until: until.value || null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('convert_to_viewer', { p_member: m.id, p_title: res.title,
        p_full_name: res.name || null, p_until: res.until });
      toast(`صار ${res.name || m.full_name} حسابَ متابعةٍ بمسمّى «${res.title}».`, 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function setStatus(btn, m, status) {
    await busy(btn, async () => {
      try {
        await db.rpc('admin_update_member', { p_member: m.id, p_status: status, p_role: null, p_languages: null });
        toast(status === 'active' ? `فُعّل حساب ${m.full_name}.` : `عُطّل حساب ${m.full_name}.`, 'ok'); reload();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  // حذفُ الحساب: لمدير المشروع، ويُكتب اسمُ العضو تأكيدًا فلا يقع بزلّة
  // ضغطة. ومن له سجلٌّ في المنصة يُردّ حذفُه ويُدلّ على التعطيل (ملاحظة ٢٠٧)
  async function removeMember(m) {
    const name = h('input', { 'aria-label': 'اسم العضو للتأكيد', autocomplete: 'off', spellcheck: 'false' });
    const why = h('input', { 'aria-label': 'سبب الحذف', placeholder: 'تسجيلٌ مكرَّر، أو لم يُباشر العمل…' });
    const res = await dialog({
      title: `حذف حساب ${m.full_name}`,
      body: h('div.stack',
        h('div.form-errors', { role: 'alert' },
          h('b', 'الحذف لا يُستدرك.'),
          h('p.small', 'يُمحى الحساب وبياناته الشخصية ولغاتُه وحسابه البنكي. '
            + 'وإن كان له سجلُّ عملٍ في المنصة — ترجمةٌ أو توقيعٌ أو مناوبةٌ أو تقييم — '
            + 'رُدّ الحذفُ، فالوجهُ حينئذٍ تعطيلُ الحساب لا محوه.')),
        h('label.field', 'اكتب اسم العضو كما هو مسجَّل', h('small', m.full_name), name),
        h('label.field', 'سبب الحذف (يُقيَّد في سجلّ المحذوفين)', why)),
      buttons: [
        { label: 'احذف الحساب', kind: 'danger',
          validate: () => (name.value.trim().replace(/\s+/g, ' ') === m.full_name.trim().replace(/\s+/g, ' ')
            ? true : 'اكتب الاسم كما هو مسجَّل أعلاه'),
          value: () => ({ name: name.value.trim(), reason: why.value.trim() }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('admin_delete_member', { p_member: m.id, p_name: res.name, p_reason: res.reason || null });
      toast(`حُذف حساب ${m.full_name}.`, 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  const showPerf = group === 'translators';

  // الفريقان الميدانيان في مكة والمدينة، متباعدان وقادتُهما مختلفون —
  // فيُفصلان بتبويبين في الشاشة لا ببندين في القائمة (ملاحظتا ٢٢٠ و٢٢٢)
  const CITY_SPLIT = ['field', 'answers'].includes(group);
  const STORE_KEY = `hs.cityTab.${group}`;
  let cityTab = '';
  if (CITY_SPLIT) { try { cityTab = localStorage.getItem(STORE_KEY) || ''; } catch { cityTab = ''; } }
  const cityTabs = h('div.seg-tabs');
  function drawCityTabs() {
    const opts = [['', 'الحرمان'], ...Object.entries(CITY)];
    cityTabs.replaceChildren(...opts.map(([k, label]) => {
      const n = members.filter(m => m.status !== 'pending' && (!k || m.city === k)).length;
      const b = h('button.btn.sm', { type: 'button', 'aria-pressed': k === cityTab ? 'true' : 'false' },
        label, h('span.sub', ` ${n}`));
      if (k === cityTab) b.classList.add('primary');
      b.onclick = () => {
        cityTab = k;
        try { localStorage.setItem(STORE_KEY, k); } catch { /* تخزين غير متاح */ }
        drawCityTabs(); draw();
      };
      return b;
    }));
  }

  function draw() {
    const list = members.filter(m => m.status !== 'pending')
      .filter(m => !CITY_SPLIT || !cityTab || m.city === cityTab)
      .filter(m => !filterLang.value || langsOf(m).includes(filterLang.value))
      .filter(m => !filterStatus.value || m.status === filterStatus.value)
      .filter(m => !q.value.trim() || m.full_name.includes(q.value.trim()) || m.email.includes(q.value.trim()));
    table.replaceChildren(list.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الاسم', 'الدور', 'اللغات', showPerf ? 'التقييم' : 'رقم العضوية', 'السرية', 'الحالة', ''].map(t => h('th', t)))),
      h('tbody', list.map(m => h('tr',
        h('td', { 'data-label': 'الاسم' }, h('b', m.full_name), h('span.sub', { dir: 'ltr' }, m.email)),
        h('td', { 'data-label': 'الدور' }, roleLabel(m),
          m.admin_title ? h('div.small.muted', 'بصلاحية منسق') : null,
          leadScope(m) ? h('div.small.muted', leadScope(m)) : null,
          m.is_trainer ? h('span.badge', { title: 'مدرِّب' }, 'مدرِّب') : null),
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
          // «يترجم» تُعلَّم على غير فريق الترجمة لأنها فيهم استثناء،
          // وغيابُها عن المترجم المتخصص يُعلَّم لأنه فيه خروجٌ عن الأصل
          m.may_translate && trackOf(m) !== 'translation'
            ? h('span.badge.gold', { title: 'يظهر في الإسناد للغاته المسجَّلة' }, 'يترجم') : null,
          !m.may_translate && trackOf(m) === 'translation'
            ? h('span.badge.warn', { title: 'لا يظهر في قائمة الإسناد' }, 'لا يترجم') : null,
          m.mfa_required ? h('span.badge', { title: 'مُلزَم بالتحقق بخطوتين' }, 'تحقق') : null,
          isManager() && Object.values(m.perms || {}).some(v => v === false)
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
            : h('button.btn.sm', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'),
          can('delete_member')
            ? h('button.btn.sm.ghost', { type: 'button', title: 'حذفٌ لا يُستدرك',
                onclick: () => removeMember(m) }, 'حذف') : null)))))))
      : emptyState('لا أعضاء مطابقون', 'غيّر عوامل التصفية.'));
  }
  [filterLang, filterStatus, q].forEach(el => el.addEventListener('input', draw));
  if (CITY_SPLIT) drawCityTabs();
  draw();

  const pending = members.filter(m => m.status === 'pending');
  const tools = h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
    isManager() && h('button.btn.sm.primary', { type: 'button', onclick: addMember }, '＋ إضافة عضو'),
    h('button.btn.sm', { type: 'button', onclick: exportTeam }, 'تصدير البيانات'));

  // التسجيلُ الإداريُّ لا يبتّ فيه إلا مديرُ المشروع (ملاحظة ٢٧٠):
  // فمن يُدخل نظيرًا له يستطيع أن يُدخل من يشاء
  const adminJoin = m => privOf[m.id]?.applied_as === 'coordinator';
  const joinsCard = h('div.card', h('h3', `طلبات التسجيل (${pending.length})`),
      pending.length ? h('div.stack', pending.map(m => h('div.row', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '10px' } },
        h('div', { style: { flex: 1, minWidth: '200px' } }, h('b', m.full_name), h('div.small.muted', { dir: 'ltr' }, m.email),
          h('div.small', 'تقدّم بصفة: ', h('b', APPLIED_LABEL[privOf[m.id]?.applied_as] || 'غير محددة')),
          h('div.small', 'اللغات: ', langsOf(m).map(langName).join('، ') || '—')),
        h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'مراجعة الملف'),
        adminJoin(m) && !isManager()
          ? h('span.pill.warn', 'بانتظار مدير المشروع')
          : h('button.btn.sm.primary', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'),
        adminJoin(m) && !isManager() ? null
          : h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'رفض'),
        isManager()
          ? h('button.btn.sm', { type: 'button', title: 'حسابٌ للمتابعة بمسمّى وظيفيٍّ تكتبه',
              onclick: () => toViewer(m) }, 'تحويلٌ إلى حساب متابعة') : null,
        can('delete_member')
          ? h('button.btn.sm.ghost', { type: 'button', title: 'حذفٌ لا يُستدرك',
              onclick: () => removeMember(m) }, 'حذف') : null)))
        : h('p.muted', 'لا توجد طلبات جديدة.'),
      pending.some(adminJoin) && !isManager()
        ? h('p.small.muted', 'ما تقدّم صاحبُه بصفةٍ إدارية يبتّ فيه مديرُ المشروع.') : null,
      h('p.small.muted', 'رابط التسجيل لمشاركته مع المترجمين: ', h('span', { dir: 'ltr' }, location.origin + '/register')));

  const filtersRow = h('div.grid', { style: { margin: '16px 0' } },
    h('label.field', 'بحث', q), h('label.field', 'اللغة', filterLang), h('label.field', 'الحالة', filterStatus));

  // أجزاء تُركَّب داخل شاشة «شؤون الفريق» الموحّدة (ملاحظة ٩٨)
  if (opts.parts) return { tools, joins: joinsCard, filters: filtersRow, table, cityTabs: CITY_SPLIT ? cityTabs : null, pendingCount: pending.length, members, privOf, bankOf, reload, track, group };

  return h('div',
    h('div.page-head', tools,
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'فريق العمل'),
        h('p.muted', 'ينضم الأعضاء عبر صفحة التسجيل، ثم يفعّلهم المنسق. التعطيل يحفظ سجل العضو بدل حذفه، ولا يُعطَّل من لديه مهمة قائمة.'))),
    joinsCard, CITY_SPLIT ? cityTabs : null, filtersRow, table);
}
