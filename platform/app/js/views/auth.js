import { h, toast, busy } from '../ui.js';
import { auth, db, storage } from '../sb.js';
import { state, loadProfile, STATUS_LABEL } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';

function frame(...children) {
  return h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/start'), h('div.spacer'), themeToggle())),
    h('main#main.auth-wrap', children),
    footer());
}
const errorsBox = () => h('div.form-errors', { hidden: true, role: 'alert' });
function showErrors(box, list) {
  box.replaceChildren(h('ul', list.map(e => h('li', e))));
  box.hidden = !list.length;
  if (list.length) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------------------------------------------------------------------
export async function login(ctx) {
  if (auth.session) { ctx.navigate('/app', { replace: true }); return h('div'); }
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const errs = errorsBox();
  const submit = h('button.btn.primary', { type: 'submit' }, 'دخول');

  const form = h('form.stack', { onsubmit: e => {
    e.preventDefault();
    busy(submit, async () => {
      try {
        await auth.signIn(email.value.trim(), password.value);
        await loadProfile();
        ctx.navigate(ctx.query.get('next') || '/app', { replace: true });
      } catch (err) { showErrors(errs, [err.message]); }
    });
  } },
    h('div', h('h2', 'تسجيل الدخول'), h('p.muted.small', 'يحدد الحساب نوع المستخدم ومساحة العمل تلقائيًا.')),
    errs,
    h('label.field', 'البريد الإلكتروني', email),
    h('label.field', 'كلمة المرور', password),
    submit,
    h('div.row', h('a', { href: '/register' }, 'التسجيل في فريق الترجمة'), h('span.muted', '·'),
      h('a', { href: '#', onclick: async e => {
        e.preventDefault();
        if (!email.value.trim()) return showErrors(errs, ['اكتب بريدك أولًا ثم اضغط «نسيت كلمة المرور»']);
        try { await auth.recover(email.value.trim()); toast('أرسلنا رابط استعادة كلمة المرور إلى بريدك.', 'ok'); }
        catch (err) { showErrors(errs, [err.message]); }
      } }, 'نسيت كلمة المرور')),
    h('div.row.small', h('a', { href: '/' }, 'خطب الحرمين الشريفين — للمستفيدين'), h('span.muted', '·'), h('a', { href: '/start' }, 'العودة إلى الشاشات الرئيسية')));
  return frame(h('div.card.auth-card.login-panel', form));
}

// ---------------------------------------------------------------------
export async function register(ctx) {
  const f = {
    full_name: h('input', { autocomplete: 'name', required: true }),
    email: h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' }),
    whatsapp: h('input', { type: 'tel', autocomplete: 'tel', dir: 'ltr', placeholder: '+9665XXXXXXXX' }),
    nationality: h('input'),
    national_id: h('input', { inputmode: 'numeric', dir: 'ltr', maxlength: 10, placeholder: '1XXXXXXXXX أو 2XXXXXXXXX' }),
    residence: h('input', { placeholder: 'المدينة والحي، أو الدولة لمن يعمل عن بُعد' }),
    password: h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: 8 }),
    confirm: h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' }),
    consent: h('input', { type: 'checkbox' })
  };
  const chosen = new Set();
  const langList = h('div.lang-pills', state.languages.filter(l => l.is_active).map(l =>
    h('button', { type: 'button', 'aria-pressed': 'false', onclick: e => {
      const on = !chosen.has(l.code); on ? chosen.add(l.code) : chosen.delete(l.code);
      e.currentTarget.setAttribute('aria-pressed', String(on));
    } }, l.name_ar)));
  const errs = errorsBox();
  const submit = h('button.btn.primary', { type: 'submit' }, 'إرسال طلب التسجيل');

  function validate() {
    const e = [];
    if (f.full_name.value.trim().length < 3) e.push('اكتب الاسم الكامل');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) e.push('البريد الإلكتروني غير صحيح');
    if (f.whatsapp.value && !/^\+?[0-9\s-]{8,16}$/.test(f.whatsapp.value.trim())) e.push('رقم واتس آب غير صحيح');
    const nid = f.national_id.value.trim();
    if (nid && !/^[12][0-9]{9}$/.test(nid)) e.push('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ (هوية) أو ٢ (إقامة)');
    if (!chosen.size) e.push('اختر لغة ترجمة واحدة على الأقل');
    if (f.password.value.length < 8) e.push('كلمة المرور ٨ أحرف على الأقل');
    if (f.password.value !== f.confirm.value) e.push('كلمتا المرور غير متطابقتين');
    if (!f.consent.checked) e.push('يلزم الإقرار بإشعار الخصوصية');
    return e;
  }

  const form = h('form.stack', { novalidate: true, onsubmit: e => {
    e.preventDefault();
    const list = validate();
    showErrors(errs, list);
    if (list.length) return;
    busy(submit, async () => {
      try {
        await auth.signUp(f.email.value.trim(), f.password.value, {
          full_name: f.full_name.value.trim(), whatsapp: f.whatsapp.value.trim() || null,
          nationality: f.nationality.value.trim() || null, national_id: f.national_id.value.trim() || null,
          residence: f.residence.value.trim() || null, languages: [...chosen]
        });
        form.replaceWith(h('div.stack',
          h('h2', 'وصل طلبك'),
          h('p', 'أرسلنا رابط تأكيد إلى بريدك. بعد التأكيد، يراجع المنسق طلبك ويفعّل حسابك، ثم تستطيع الدخول واستلام المهام.'),
          h('a.btn', { href: '/login' }, 'صفحة الدخول')));
      } catch (err) { showErrors(errs, [err.message]); }
    });
  } },
    h('h2', 'التسجيل في فريق الترجمة'),
    h('p.muted', 'يُراجع المنسق الطلب ويفعّله. تُسند مهام المراجعة والتحرير لاحقًا حسب اللغة ولا تحتاج تسجيلًا منفصلًا.'),
    errs,
    h('div.grid-2',
      h('label.field', 'الاسم الكامل', f.full_name),
      h('label.field', 'البريد الإلكتروني', h('small', 'تدخل به إلى المنصة'), f.email),
      h('label.field', 'رقم واتس آب', f.whatsapp),
      h('label.field', 'الجنسية', f.nationality),
      h('label.field', 'رقم الهوية أو الإقامة', h('small', 'اختياري لمن يعمل من خارج المملكة'), f.national_id),
      h('label.field', 'مكان الإقامة', f.residence)),
    h('fieldset', h('legend', 'لغات الترجمة'), langList),
    h('div.grid-2',
      h('label.field', 'كلمة المرور', h('small', '٨ أحرف على الأقل'), f.password),
      h('label.field', 'تأكيد كلمة المرور', f.confirm)),
    h('p.small.muted', 'صورة الإقامة تُرفع بعد تأكيد البريد والدخول الأول، ولا يطّلع عليها إلا المنسق ومدير المشروع.'),
    h('label.check', f.consent, 'أقر بأن بياناتي تُستخدم لإدارة أعمال الترجمة في المشروع فقط، ولا يطّلع على الهوية والإقامة إلا المنسق ومدير المشروع.'),
    submit,
    h('a', { href: '/login' }, 'لديك حساب؟ الدخول'));
  return frame(h('div.card.auth-card.wide', form));
}

// ---------------------------------------------------------------------
export async function reset(ctx) {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const errs = errorsBox();
  const submit = h('button.btn.primary', { type: 'submit' }, 'حفظ كلمة المرور');
  if (!auth.session) {
    return frame(h('div.card.auth-card', h('h2', 'الرابط غير صالح'), h('p', 'افتح رابط الاستعادة من بريدك مرة أخرى، أو اطلب رابطًا جديدًا من صفحة الدخول.'), h('a.btn', { href: '/login' }, 'الدخول')));
  }
  return frame(h('div.card.auth-card', h('form.stack', { onsubmit: e => {
    e.preventDefault();
    const list = [];
    if (pw.value.length < 8) list.push('كلمة المرور ٨ أحرف على الأقل');
    if (pw.value !== pw2.value) list.push('كلمتا المرور غير متطابقتين');
    showErrors(errs, list);
    if (list.length) return;
    busy(submit, async () => {
      try { await auth.updatePassword(pw.value); toast('تم تحديث كلمة المرور.', 'ok'); ctx.navigate('/app', { replace: true }); }
      catch (err) { showErrors(errs, [err.message]); }
    });
  } }, h('h2', 'كلمة مرور جديدة'), errs, h('label.field', 'كلمة المرور', pw), h('label.field', 'تأكيدها', pw2), submit)));
}

// ---------------------------------------------------------------------
// صفحة العضو غير المفعّل: حالة الطلب ورفع صورة الإقامة
export async function pending() {
  const p = state.profile;
  const [priv] = await db.select('profile_private', { select: '*', id: `eq.${p.id}` });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const status = h('p', priv?.iqama_path ? 'صورة الإقامة مرفوعة.' : 'لم تُرفع صورة الإقامة بعد.');
  const upload = h('button.btn', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
    const f = file.files[0];
    if (!f) return toast('اختر الصورة أولًا.', 'bad');
    if (f.size > 5 * 1024 * 1024) return toast('الحد الأقصى ٥ ميغابايت.', 'bad');
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast('الصيغ المقبولة: JPG أو PNG أو WebP.', 'bad');
    try {
      const path = `${p.id}/iqama-${Date.now()}.${f.type.split('/')[1]}`;
      await storage.upload('private-docs', path, f);
      await db.update('profile_private', { id: `eq.${p.id}` }, { iqama_path: path });
      status.textContent = 'صورة الإقامة مرفوعة.';
      toast('رُفعت الصورة.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }) }, 'رفع الصورة');

  return frame(h('div.card.auth-card.stack',
    h('h2', p.status === 'disabled' ? 'الحساب معطّل' : 'حسابك بانتظار التفعيل'),
    h('p', p.status === 'disabled'
      ? 'عُطّل هذا الحساب. تواصل مع منسق المشروع إن كان ذلك خطأ.'
      : `مرحبًا ${p.full_name}. وصل طلبك وحالته: ${STATUS_LABEL[p.status]}. سيظهر لك ما يُسند إليك فور تفعيل المنسق لحسابك.`),
    p.status === 'pending' && h('fieldset', h('legend', 'صورة الإقامة (اختياري)'), status, h('div.row', file, upload),
      h('p.small.muted', 'لا يطّلع عليها إلا المنسق ومدير المشروع.')),
    h('div.row', h('button.btn', { onclick: () => location.reload() }, 'تحديث الحالة'), h('button.btn', { onclick: () => auth.signOut().then(() => location.assign('/login')) }, 'خروج'))));
}
