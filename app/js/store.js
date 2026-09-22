// الحالة المشتركة: المستخدم الحالي والبيانات المرجعية
import { auth, db } from './sb.js';

export const state = {
  profile: null,      // صف profiles للمستخدم الحالي
  languages: [],
  stages: [],
  khateebs: [],
  loadedRef: false
};

export const ROLE_LABEL = { manager: 'مدير المشروع', coordinator: 'منسق', translator: 'مترجم' };
export const STATUS_LABEL = { pending: 'بانتظار التفعيل', active: 'مفعّل', disabled: 'معطّل' };
export const TRACK_STATUS = {
  awaiting_receipt: ['بانتظار الاستلام', 'warn'],
  in_progress: ['قيد التنفيذ', 'gold'],
  awaiting_approval: ['بانتظار اعتماد المدير', 'gold'],
  completed: ['مكتملة', 'ok']
};
export const MOSQUE = { makkah: 'المسجد الحرام', madinah: 'المسجد النبوي' };
export const CITY = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };
export const PRIORITY = { normal: 'اعتيادية', urgent: 'عاجلة', emergency: 'طارئة' };
export const MATERIAL_TYPES = ['خطب', 'دروس علمية', 'إعلانات', 'توجيهات', 'كتب', 'مطويات', 'منشورات'];
export const SERMON_TYPES = ['خطبة جمعة', 'خطبة عرفة', 'خطبة استسقاء', 'خطبة كسوف'];
export const EVENT_LABEL = {
  assigned: 'إسناد المراحل وإرسال المادة', accepted: 'استلام المهمة وقبولها', edited: 'حفظ تعديل على الترجمة',
  audio_uploaded: 'رفع التسجيل الصوتي', completed: 'إتمام المرحلة', returned: 'إعادة للتعديل',
  published: 'النشر على الموقع العام', unpublished: 'إخفاء من الموقع العام',
  reassigned: 'تغيير المسؤول'
};

export const isAdmin = () => ['manager', 'coordinator'].includes(state.profile?.role) && state.profile?.status === 'active';
export const isManager = () => state.profile?.role === 'manager' && state.profile?.status === 'active';
export const isActive = () => state.profile?.status === 'active';

export async function loadProfile() {
  if (!auth.session) { state.profile = null; return null; }
  const uid = auth.user?.id || (await auth.loadUser())?.id;
  const rows = await db.select('profiles', { select: '*', id: `eq.${uid}` });
  state.profile = rows[0] || null;
  return state.profile;
}

export async function loadReference(force = false) {
  if (state.loadedRef && !force) return;
  const [languages, stages, khateebs] = await Promise.all([
    db.select('languages', { select: '*', order: 'sort.asc' }),
    db.select('workflow_stages', { select: '*', order: 'sort.asc' }),
    db.select('khateebs', { select: '*', order: 'mosque.asc,sort.asc' })
  ]);
  Object.assign(state, { languages, stages, khateebs, loadedRef: true });
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
