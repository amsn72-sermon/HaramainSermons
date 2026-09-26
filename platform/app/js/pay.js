// مشتركات الرواتب والحضور: المسمّيات وصياغة المبالغ والأوقات (ملاحظتا ١١٦ و١١٧)

export const PAY_TYPE = {
  none: 'بلا أجر مسجّل',
  monthly: 'شهري',
  per_work: 'مقطوع لكل عمل'
};

export const PAYROLL_STATUS = {
  draft: ['مسودة', 'warn'],
  approved: ['معتمدة', 'gold'],
  paid: ['مصروفة', 'ok']
};

// أنواع الأعمال في التسعيرة بالمقطوع (ملاحظة ١١٨)
export const WORK_KIND = {
  sermon_audio: 'خطبة مع تسجيل صوتي',
  sermon_text: 'خطبة كتابية',
  lesson_audio: 'درس علمي مع تسجيل صوتي',
  lesson_text: 'درس علمي كتابي',
  book: 'كتاب',
  booklet: 'مطوية',
  post: 'منشور',
  announcement: 'إعلان',
  directive: 'توجيه',
  other: 'عمل آخر'
};

export const WORK_KINDS = Object.keys(WORK_KIND);
export const kindName = k => WORK_KIND[k] || k;

export const SHIFT_STATUS = {
  scheduled: ['مجدولة', ''],
  present: ['حضر', 'ok'],
  absent: ['غياب', 'bad'],
  leave: ['إجازة', 'warn']
};

// المبالغ بأرقام لاتينية وخانتين عشريتين، ليسهل نقلها إلى كشوف المالية
export const money = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const riyal = v => money(v) + ' ر.س';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// 2026-03-01 ← «مارس 2026»
export function monthLabel(v) {
  if (!v) return '—';
  const [y, m] = String(v).slice(0, 7).split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

export const monthValue = v => String(v || '').slice(0, 7);
export const monthStart = v => (v ? `${monthValue(v)}-01` : null);
export const thisMonth = () => today().slice(0, 7);

// 14:30:00 ← 14:30
export const hhmm = t => String(t || '').slice(0, 5);

// دقائق التأخير كما تُقرأ: ساعة وربع لا ٧٥ دقيقة
export function lateText(min) {
  const n = Number(min || 0);
  if (n <= 0) return 'في الوقت';
  if (n < 60) return `${n} دقيقة`;
  const hrs = Math.floor(n / 60), rest = n % 60;
  return rest ? `${hrs} ساعة و${rest} دقيقة` : `${hrs} ساعة`;
}

export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// أول أيام أسبوع التاريخ المعطى (الأحد)
export function weekStart(dateStr) {
  const d = new Date(`${dateStr || today()}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return ymd(d);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// اليوم بتوقيت الرياض لا بتوقيت جهاز العضو: الوردية والبصمة يومهما واحد
// في الحرمين وإن سافر المرشد أو اختلّ ضبط جواله (ملاحظة ١١٧)
const RIYADH = new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => RIYADH.format(new Date());
