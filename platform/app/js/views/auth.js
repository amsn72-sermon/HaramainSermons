import { h, toast, busy, dialog, req } from '../ui.js';
import { auth, db, storage } from '../sb.js';
import { state, loadProfile, STATUS_LABEL } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';

function frame(...children) {
  return h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/app'), h('div.spacer'),
      // يطّلع المسؤولون على تعريف المنصة دون تسجيل (ملاحظة ٩١)
      h('a.btn.sm.ghost', { href: '/about' }, 'عن المنصة'),
      themeToggle())),
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
        // نافذة مستقلة لكتابة البريد ثم الإرسال (ملاحظة ٦٤)
        const box = h('input', { type: 'email', dir: 'ltr', autocomplete: 'username', value: email.value.trim() });
        const to = await dialog({
          title: 'استعادة كلمة المرور',
          body: h('div.stack',
            h('p.small.muted', 'اكتب بريدك المسجَّل في المنصة، ونرسل إليه رابط تعيين كلمة مرور جديدة.'),
            h('label.field', 'البريد الإلكتروني', box)),
          buttons: [
            { label: 'إرسال الرابط', kind: 'primary', validate: () => {
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(box.value.trim())) { toast('البريد الإلكتروني غير صحيح.', 'bad'); return false; }
              return true;
            }, value: () => box.value.trim() },
            { label: 'إلغاء', value: null }
          ]
        });
        if (!to) return;
        try { await auth.recover(to); toast('أرسلنا رابط استعادة كلمة المرور إلى بريدك، وراجع مجلد البريد غير المرغوب إن تأخر.', 'ok'); }
        catch (err) { showErrors(errs, [err.message]); }
      } }, 'نسيت كلمة المرور')),
);
  return frame(h('div.card.auth-card.login-panel', form));
}

// ---------------------------------------------------------------------
export async function register(ctx) {
  // باب التسجيل: يفتحه مدير المشروع ويغلقه، فلا يُملأ نموذجٌ يُردّ (ملاحظة ١٧٤)
  const reg = await db.rpc('registration_state').then(r => (Array.isArray(r) ? r[0] : r) || {})
    .catch(() => ({ open: true }));
  if (reg.open === false) {
    return frame(h('div.card.auth-card.stack',
      h('h2', 'التسجيل مغلق حاليًّا'),
      h('p', reg.note || 'باب التسجيل في المنصة مغلق في الوقت الحالي. '
        + 'إن كنت مدعوًّا للانضمام إلى فريق الترجمة فراجع منسق المشروع، '
        + 'فيُفتح لك أو يُنشأ حسابك مباشرة.'),
      h('div.row', h('a.btn', { href: '/login' }, 'لديك حساب؟ الدخول'),
        h('a.btn.ghost', { href: '/about' }, 'عن المنصة'))));
  }

  const f = {
    full_name: h('input', { autocomplete: 'name', required: true }),
    email: h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' }),
    whatsapp: h('input', { type: 'tel', autocomplete: 'tel', dir: 'ltr', required: true,
      placeholder: '+9665XXXXXXXX' }),
    // مدينة المرشد المكاني: يُدعى بها إلى ما يخصّ مسجده (ملاحظة ١٨٥)
    city: h('select', { 'aria-label': 'مدينة العمل' },
      h('option', { value: '' }, '— اختر —'),
      h('option', { value: 'makkah' }, 'مكة المكرمة — المسجد الحرام'),
      h('option', { value: 'madinah' }, 'المدينة المنورة — المسجد النبوي')),
    id_type: h('select',
      h('option', { value: 'national' }, 'هوية وطنية أو إقامة'),
      h('option', { value: 'passport' }, 'جواز سفر (لمن خارج المملكة)')),
    national_id: h('input', { inputmode: 'numeric', dir: 'ltr', maxlength: 15, required: true,
      placeholder: '1XXXXXXXXX أو 2XXXXXXXXX' }),
    password: h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: 8 }),
    confirm: h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' }),
    consent: h('input', { type: 'checkbox' }),
    // المنسقون يسجّلون بنفس الرابط وأكثرهم لا يترجم (ملاحظة ٦٣)
    applied_as: h('select',
      h('option', { value: 'translator' }, 'مترجم أو مراجع'),
      h('option', { value: 'coordinator' }, 'منسق أو إداري (لا أترجم)'),
      h('option', { value: 'field' }, 'مترجم ميداني — الإرشاد المكاني')),
  };
  // اللغات والصور وبقية البيانات تُستكمل بعد التفعيل، فلا تُثقل التسجيل
  // (ملاحظة ١٧٩). والمرشد وحده يحدّد مدينته هنا، إذ تُبنى عليها دعواته.
  const cityBox = h('label.field', req('مدينة العمل'),
    h('small', 'المسجد الذي ترشد فيه — تُبنى عليه دعوات التدريب والاجتماعات'), f.city);
  const drawCity = () => { cityBox.hidden = f.applied_as.value !== 'field'; };
  f.applied_as.addEventListener('change', drawCity);
  drawCity();

  const errs = errorsBox();
  const submit = h('button.btn.primary', { type: 'submit' }, 'إرسال طلب التسجيل');

  function validate() {
    const e = [];
    if (f.full_name.value.trim().length < 3) e.push('اكتب الاسم الكامل');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) e.push('البريد الإلكتروني غير صحيح');
    if (!f.whatsapp.value.trim()) e.push('رقم الجوال بيان أساسي');
    else if (!/^\+?[0-9\s-]{8,16}$/.test(f.whatsapp.value.trim())) e.push('رقم الجوال غير صحيح');
    const nid = f.national_id.value.trim().toUpperCase();
    if (!nid) e.push('رقم الهوية أو الإقامة أو الجواز بيان أساسي');
    else if (f.id_type.value === 'passport') {
      if (!/^[A-Z0-9]{5,15}$/.test(nid)) e.push('رقم الجواز من خمسة إلى خمسة عشر حرفًا ورقمًا');
    } else if (!/^[12][0-9]{9}$/.test(nid)) {
      e.push('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ (هوية) أو ٢ (إقامة)');
    }
    if (f.applied_as.value === 'field' && !f.city.value) e.push('حدّد مدينتك: مكة المكرمة أو المدينة المنورة');
    if (f.password.value.length < 8) e.push('كلمة المرور ٨ أحرف على الأقل');
    if (f.password.value !== f.confirm.value) e.push('كلمتا المرور غير متطابقتين');
    if (!f.consent.checked) e.push('يلزم الإقرار بصحة المعلومات');
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
          full_name: f.full_name.value.trim(),
          whatsapp: f.whatsapp.value.trim(),
          national_id: f.national_id.value.trim().toUpperCase(),
          id_type: f.id_type.value,
          applied_as: f.applied_as.value,
          city: f.applied_as.value === 'field' ? f.city.value : null
        });
        form.replaceWith(h('div.stack',
          h('h2', 'وصل طلبك'),
          h('p', 'أرسلنا رابط تأكيد إلى بريدك. بعد التأكيد يراجع المنسق طلبك ويفعّل حسابك. '
            + 'وأول ما تدخل تجد شاشة «أكمل بياناتك»: الجنسية ومكان الإقامة ولغاتك وصورتك '
            + 'وصورة هويتك — تستكملها هناك على مهل، ثم يدققها المنسق ويقبلها.'),
          h('a.btn', { href: '/login' }, 'صفحة الدخول')));
      } catch (err) { showErrors(errs, [err.message]); }
    });
  } },
    h('h2', 'التسجيل في فريق الترجمة'),
    h('p.muted', 'التسجيل أربعة بيانات لا غير: اسمك وبريدك ورقم هويتك وجوالك. '
      + 'وما سواها تستكمله بعد تفعيل حسابك على مهل، فلا يحبسك عن التسجيل شيء.'),
    errs,
    h('label.field', 'أتقدّم بصفة', f.applied_as),
    cityBox,
    h('div.grid-2',
      h('label.field', req('الاسم الكامل'),
        h('small', 'كما في الهوية — بيان أساسي لا يُعدَّل لاحقًا إلا من المنسق'), f.full_name),
      h('label.field', req('البريد الإلكتروني'), h('small', 'تدخل به إلى المنصة'), f.email),
      h('label.field', req('رقم الجوال'), h('small', 'للتواصل العاجل وواتس آب'), f.whatsapp),
      h('label.field', 'نوع الهوية', f.id_type),
      h('label.field', req('رقم الهوية أو الإقامة'),
        h('small', 'بيان أساسي لا يُعدَّل لاحقًا إلا من المنسق'), f.national_id)),
    h('div.grid-2',
      h('label.field', req('كلمة المرور'), h('small', '٨ أحرف على الأقل'), f.password),
      h('label.field', req('تأكيد كلمة المرور'), f.confirm)),
    h('p.small.muted', 'وبعد التفعيل تستكمل: الجنسية ومكان الإقامة واللغات والصورة الشخصية '
      + 'وصورة الهوية — ثم يدققها المنسق ويقبلها.'),
    h('label.check.top', f.consent, 'أقرّ بأن جميع المعلومات التي أدخلتها صحيحة، وأتحمّل مسؤولية صحتها.'),
    h('p.small.muted', 'تُستخدم بياناتك لإدارة أعمال الترجمة في المشروع فقط، ولا يطّلع على الهوية والإقامة إلا المنسق ومدير المشروع.'),
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
