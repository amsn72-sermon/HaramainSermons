// الحالة المشتركة: المستخدم الحالي والبيانات المرجعية
import { auth, db } from './sb.js';
import { POLICY_KEY, POLICY_VERSION } from './policy.js';

export const state = {
  profile: null,      // صف profiles للمستخدم الحالي
  languages: [],
  stages: [],
  khateebs: [],
  loadedRef: false,
  policySigned: false,   // وقّع العضو نسخة سياسة السرية الحالية
  policyLoaded: false,
  blockingCirculars: 0,  // تعاميم ملزمة لم يوقّع عليها (ملاحظة ٨٩)
  circularsLoaded: false,
  mfaOk: true,           // التحقق بخطوتين: مستوفًى أو غير لازم (ملاحظة ١٠٣)
  mfaEnrolled: false,
  mfaRequired: true,     // إلزامه على حسابات الإدارة — مفتاح بيد مدير المشروع
  mfaExempt: false,      // معفًى صراحةً، يعلو على الإلزام العام (ملاحظة ٢٢٤)
  mfaLoaded: false,
  periods: [],           // فترات الدوام كما هي في الجدول (ملاحظة ٢٢٨)
  filePattern: null      // نمط تسمية الملفات المسلَّمة (ملاحظة ١٤٤)
};

export const ROLE_LABEL = { manager: 'مدير المشروع', coordinator: 'منسق', translator: 'مترجم',
  supervisor: 'مدير المشروع من الهيئة', field_lead: 'قائد الفريق الميداني' };
// فتراتُ الدوام: أسماؤها من الجدول، وهذه أسماءُ المبذورة منها (ملاحظة ٢٢٨)
export const PERIOD_LABEL = { morning: 'الصباحية', evening: 'المسائية', night: 'الليلية' };
export const periodName = code =>
  (state.periods.find(p => p.code === code)?.name) || PERIOD_LABEL[code] || code || '';
export const periodRange = code => {
  const p = state.periods.find(x => x.code === code);
  return p ? `${String(p.start_at).slice(0, 5)} – ${String(p.end_at).slice(0, 5)}` : '';
};
// القيادةُ صارت بالأسماء لا بالنطاق: لكلِّ عضوٍ قائدٌ واحد (ملاحظة ٢٢٨)
export const LEAD_KIND = { field: 'قائد فريق ميداني', translation: 'مشرف فريق الترجمة' };
export const isTeamLead = () => state.profile?.status === 'active'
  && (state.profile?.role === 'field_lead' || !!state.profile?.lead_kind);
export const leadScope = m =>
  (m?.lead_kind ? LEAD_KIND[m.lead_kind] : (m?.role === 'field_lead' ? LEAD_KIND.field : ''));
// نمطُ العمل: عن بُعدٍ أو حضوري — والحضوريُّ له موقعٌ وفترةٌ ومناوبات (ملاحظة ٢٢٧)
export const WORK_MODE = { remote: 'عن بُعد', onsite: 'حضوري' };
// أيامُ الأسبوع كما تعدّها قاعدة البيانات: ٠ الأحد
export const WEEK_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const daysLabel = days => {
  const d = (days || []).map(Number).sort((a, b) => a - b);
  if (!d.length) return 'لا أيام';
  if (d.length === 7) return 'كل الأيام';
  return d.map(i => WEEK_DAYS[i]).join('، ');
};

// صفتان تُكتبان على حساب المنسق، وصلاحيتُهما صلاحيتُه نفسُها (ملاحظة ٢٠٠)
export const ADMIN_TITLE = {
  ops_manager: 'مدير العمليات التشغيلية',
  ops_deputy:  'مساعد مدير العمليات'
};
// الصفةُ المكتوبة إن وُجدت، وإلا فاسمُ الدور
export const roleLabel = m =>
  (m && m.admin_title && ADMIN_TITLE[m.admin_title])
  || ROLE_LABEL[m?.role] || m?.role || '';
export const STATUS_LABEL = { pending: 'بانتظار التفعيل', active: 'مفعّل', disabled: 'معطّل' };
export const TRACK_STATUS = {
  awaiting_receipt: ['بانتظار الاستلام', 'warn'],
  in_progress: ['قيد التنفيذ', 'gold'],
  awaiting_approval: ['بانتظار اعتماد المدير', 'gold'],
  completed: ['مكتملة', 'ok']
};
export const MOSQUE = { makkah: 'المسجد الحرام', madinah: 'المسجد النبوي' };
// مادة عامة لا تتبع مسجدًا (كتب، مطويات، منشورات، إعلانات، توجيهات) — ملاحظة ٦٩
export const GENERAL_MOSQUE = 'general';
export const MOSQUE_ANY = { ...MOSQUE, general: 'مادة عامة' };
export const SERMON_MATERIALS = ['خطب', 'دروس علمية'];
export const needsMosque = type => SERMON_MATERIALS.includes(type);
export const CITY = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };
// الفرق الثلاثة: والثالث يُنقل إليه ولا يُسجَّل فيه (ملاحظة ١٨٦)
export const TRACK_LABEL = {
  translation: 'الترجمة التخصصية',
  field: 'الإرشاد المكاني',
  answers: 'إجابة السائلين'
};
export const trackOf = m => (TRACK_LABEL[m?.track] ? m.track : 'translation');
// لا فتوى لأحدٍ من الفريق البتّة: ينقل السؤال ثم ينقل الجواب (ملاحظة ١٨٦)
export const NO_FATWA = 'ليس لأحد من الفريق أن يفتي بشيء: ينقل السؤال إلى أهل الفتوى، '
  + 'ثم ينقل جوابهم كما هو، لا يزيد فيه ولا ينقص.';
export const PRIORITY = { normal: 'اعتيادية', urgent: 'عاجلة', emergency: 'طارئة' };
export const MATERIAL_TYPES = ['خطب', 'دروس علمية', 'إعلانات', 'توجيهات', 'كتب', 'مطويات', 'منشورات'];
// أنواع الخطب — ولكل نوع رمزه في ترقيم التوثيق (ملاحظة ١٣٤)
export const SERMON_TYPES = ['خطبة جمعة', 'خطبة عرفة', 'خطبة عيد الأضحى', 'خطبة عيد الفطر',
  'خطبة استسقاء', 'خطبة كسوف', 'خطبة خسوف'];
export const EVENT_LABEL = {
  assigned: 'إسناد المراحل وإرسال المادة', accepted: 'استلام المهمة وقبولها', edited: 'حفظ تعديل على الترجمة',
  audio_uploaded: 'رفع التسجيل الصوتي', completed: 'إتمام المرحلة', returned: 'إعادة للتعديل',
  published: 'النشر على الموقع العام', unpublished: 'إخفاء من الموقع العام',
  reassigned: 'تغيير المسؤول', audio_approved: 'اعتماد التسجيل الصوتي'
};

export const isAdmin = () => ['manager', 'coordinator'].includes(state.profile?.role) && state.profile?.status === 'active';
export const isManager = () => state.profile?.role === 'manager' && state.profile?.status === 'active';
export const isActive = () => state.profile?.status === 'active';
// مدير المشروع من الهيئة: يرى ما يراه المنسق ولا يعدّل شيئًا (ملاحظتا ١٤٦ و١٦٤)
export const isSupervisor = () => state.profile?.role === 'supervisor' && state.profile?.status === 'active';
export const canViewReports = () => isAdmin() || isSupervisor();

// ---------------------------------------------------------------------
// قائمة الصلاحيات: الأصل الفتح، ويغلق مدير المشروع ما يشاء لحسابٍ بعينه
// (ملاحظة ١٧٢). ومدير المشروع يملكها كلها دائمًا.
// ---------------------------------------------------------------------
export const PERM_LABEL = {
  materials: 'إضافة المواد وإسنادها وإعادتها',
  approve: 'الاعتماد وإغلاق المراجعات والتسجيلات',
  team: 'بيانات الأعضاء وتقييمهم ووثائقهم',
  cards: 'بطاقات العمل وإصدارها',
  payroll: 'الرواتب والمستحقات',
  banks: 'الحسابات المصرفية',
  circulars: 'المراسلات الداخلية',
  shifts: 'الحضور والانصراف',
  evaluation: 'تقييم المرشدين المكانيين',
  interpretation: 'سجلّ الترجمة الفورية',
  glossary: 'اعتماد الدليل المصطلحي',
  rooms: 'القاعات واللقاءات وجدولتها',
  delete_member: 'حذف حسابات الأعضاء',
  settings: 'اللغات والخطباء وإعداد سير العمل',
  reports: 'دليل الإنتاج والأرشيف والتصدير'
};
export const PERM_KEYS = Object.keys(PERM_LABEL);
// الأصلُ في المفاتيح الفتح، إلا ما لا يُستدرك فأصلُه المنع (ملاحظة ٢١٤)
export const PERM_CLOSED = ['delete_member'];
export const can = key => (isManager() ? true
  : PERM_CLOSED.includes(key) ? state.profile?.perms?.[key] === true
  : state.profile?.perms?.[key] !== false);

export async function loadProfile() {
  if (!auth.session) { state.profile = null; return null; }
  const uid = auth.user?.id || (await auth.loadUser())?.id;
  const rows = await db.select('profiles', { select: '*', id: `eq.${uid}` });
  state.profile = rows[0] || null;
  return state.profile;
}

// إقرار سياسة السرية: يُطلب عند أول دخول بعد التفعيل، ويتجدد إذا تغيّرت نسخة السياسة (ملاحظة ٥٧)
export async function loadPolicyState(force = false) {
  if (state.policyLoaded && !force) return state.policySigned;
  if (!state.profile) return false;
  try {
    const rows = await db.select('policy_acceptances', {
      select: 'policy_version', member_id: `eq.${state.profile.id}`, policy_key: `eq.${POLICY_KEY}`
    });
    state.policySigned = rows.some(r => r.policy_version === POLICY_VERSION);
  } catch {
    // تعذّر الفحص لا يحجب العمل
    state.policySigned = true;
  }
  state.policyLoaded = true;
  return state.policySigned;
}

// التعاميم الملزمة: تُفحص عند كل دخول، ولا يتابع العضو مهامه قبل التوقيع (ملاحظة ٨٩)
export async function loadCircularState(force = false) {
  if (state.circularsLoaded && !force) return state.blockingCirculars;
  if (!state.profile) return 0;
  try {
    const n = await db.rpc('my_blocking_circulars');
    state.blockingCirculars = Number(Array.isArray(n) ? n[0] : n) || 0;
  } catch {
    // تعذّر الفحص لا يحجب العمل
    state.blockingCirculars = 0;
  }
  state.circularsLoaded = true;
  return state.blockingCirculars;
}

export async function loadReference(force = false) {
  if (state.loadedRef && !force) return;
  const [languages, stages, khateebs, settings] = await Promise.all([
    db.select('languages', { select: '*', order: 'sort.asc' }),
    db.select('workflow_stages', { select: '*', order: 'sort.asc' }),
    db.select('khateebs', { select: '*', order: 'mosque.asc,sort.asc' }),
    // الإعدادات لأصحاب الحسابات وحدهم، والموقع العام يُفتح بلا دخول (ملاحظة ١٤٤)
    auth.session ? db.select('platform_settings', { select: 'file_name_pattern' }).catch(() => []) : []
  ]);
  Object.assign(state, { languages, stages, khateebs, loadedRef: true,
    filePattern: settings[0]?.file_name_pattern || null });
}

export const langName = code => state.languages.find(l => l.code === code)?.name_ar || code;
export const langDir = code => state.languages.find(l => l.code === code)?.dir || 'ltr';
export const stageName = key => state.stages.find(s => s.key === key)?.name_ar || key;

// استعلام المواد بمساراتها ومراحلها — الصلاحيات في قاعدة البيانات تحدد ما يعود
export const TRACK_SELECT = '*,language:languages(code,name_ar,dir),stages:track_stages!track_stages_track_id_fkey(*,assignee:profiles(id,full_name))';
export const MATERIAL_SELECT = `*,khateeb:khateebs(name),tracks(${TRACK_SELECT})`;

export function trackProgress(track) {
  const stages = track.stages || [];
  const done = stages.filter(s => s.status === 'done').length;
  return { done, total: stages.length, pct: stages.length ? Math.round((done / stages.length) * 100) : 0 };
}
export function currentStage(track) {
  return (track.stages || []).find(s => s.id === track.current_stage_id) || null;
}
export function sortStages(track) { (track.stages || []).sort((a, b) => a.sort - b.sort); return track; }
export function isLateNow(track) {
  const s = currentStage(track);
  if (track.status === 'awaiting_receipt') return new Date(track.receipt_due_at) < new Date();
  return !!(s && s.due_at && new Date(s.due_at) < new Date());
}
export function hadLateness(track) {
  return (track.receipt_late_seconds || 0) > 0 || (track.stages || []).some(s => (s.late_seconds || 0) > 0);
}

// ---------------------------------------------------------------------
// التحقق بخطوتين: إلزامي على مدير المشروع والمنسقين، ومن فعّله طوعًا لزمه (ملاحظة ١٠٣)
// ---------------------------------------------------------------------
export async function loadMfaState(force = false) {
  if (state.mfaLoaded && !force) return state.mfaOk;
  let ok = true, enrolled = false;
  try {
    // حالُ الحساب كلُّها في طلبٍ واحد: العواملُ والإلزامُ والإعفاءُ وعلامةُ الجلسة
    const g = await db.rpc('my_mfa_gate').catch(() => null);
    const d = (Array.isArray(g) ? g[0] : g) || null;

    if (d) {
      enrolled = d.enrolled === true;
      state.mfaRequired = d.admins === true;
      state.mfaExempt = d.exempt === true;
      // البابُ يُفتح بأحد أمرين: مستوى التوثيق في الرمز، أو علامةُ الجلسة
      // المكتوبةُ عند التحقق — فلا يرتدُّ العضو بعد أن قيل له «تم التحقق»
      // (ملاحظة ٢٢٣)
      const satisfied = auth.aal === 'aal2' || d.session_ok === true;
      const must = !d.exempt && (d.required === true || (isAdmin() && d.admins === true));
      ok = enrolled ? satisfied : !must;
    } else {
      const [list, rows] = await Promise.all([
        auth.mfa.factors(),
        db.select('platform_settings', { select: 'mfa_required_admins' }).catch(() => [])
      ]);
      state.mfaRequired = rows[0] ? rows[0].mfa_required_admins !== false : true;
      state.mfaExempt = state.profile?.mfa_exempt === true;
      enrolled = list.some(f => f.status === 'verified');
      const mine = state.profile?.mfa_required === true;
      ok = enrolled ? auth.aal === 'aal2'
                    : state.mfaExempt || !(mine || (isAdmin() && state.mfaRequired));
    }
  } catch { ok = true; }   // تعذّر الفحص لا يُقفل الباب على العضو
  state.mfaEnrolled = enrolled;
  state.mfaOk = ok;
  state.mfaLoaded = true;
  return ok;
}

// فتراتُ الدوام — تُقرأ مرةً وتُحفظ (ملاحظة ٢٢٨)
export async function loadPeriods(force = false) {
  if (state.periods.length && !force) return state.periods;
  try {
    state.periods = await db.select('duty_periods',
      { select: '*', order: 'sort.asc,start_at.asc' });
  } catch { state.periods = []; }
  return state.periods;
}
