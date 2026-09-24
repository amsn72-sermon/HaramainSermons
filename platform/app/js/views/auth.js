import { h, fill, toast, busy, dialog } from '../ui.js';
import { auth, db, storage } from '../sb.js';
import { state, loadProfile, STATUS_LABEL } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';

function frame(...children) {
  return h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/app'), h('div.spacer'), themeToggle())),
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
  const f = {
    full_name: h('input', { autocomplete: 'name', required: true }),
    email: h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' }),
    whatsapp: h('input', { type: 'tel', autocomplete: 'tel', dir: 'ltr', placeholder: '+9665XXXXXXXX' }),
    nationality: h('input'),
    national_id: h('input', { inputmode: 'numeric', dir: 'ltr', maxlength: 10, placeholder: '1XXXXXXXXX أو 2XXXXXXXXX' }),
    residence: h('input', { placeholder: 'المدينة والحي، أو الدولة لمن يعمل عن بُعد' }),
    password: h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: 8 }),
    confirm: h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' }),
    consent: h('input', { type: 'checkbox' }),
    // المنسقون يسجّلون بنفس الرابط وأكثرهم لا يترجم (ملاحظة ٦٣)
    applied_as: h('select',
      h('option', { value: 'translator' }, 'مترجم أو مراجع'),
      h('option', { value: 'coordinator' }, 'منسق أو إداري (لا أترجم)')),
    iqama: h('input', { type: 'file', accept: 'image/*,application/pdf' })   // صورة الهوية أو الإقامة (ملاحظة ٥١)
  };
  // اختيار اللغات من قائمة منسدلة، والمختارة تظهر رقائق تُحذف بضغطة (ملاحظة ٥٠)
  const chosen = new Set();
  const langSelect = h('select', { 'aria-label': 'أضف لغة ترجمة' });
  const langChips = h('div.lang-pills.chosen');
  const activeLangs = () => state.languages.filter(l => l.is_active);
  function drawLangs() {
    const rest = activeLangs().filter(l => !chosen.has(l.code));
    fill(langSelect, h('option', { value: '' }, rest.length ? '— أضف لغة —' : '— أُضيفت كل اللغات —'),
      rest.map(l => h('option', { value: l.code }, l.name_ar)));
    langChips.replaceChildren(...[...chosen].map(code => {
      const l = state.languages.find(x => x.code === code);
      return h('button', { type: 'button', 'aria-pressed': 'true', title: 'إزالة اللغة',
        'aria-label': `إزالة ${l?.name_ar || code}`,
        onclick: () => { chosen.delete(code); drawLangs(); } },
        h('span.tick', { 'aria-hidden': 'true' }, '✓'), l?.name_ar || code, h('span.x', { 'aria-hidden': 'true' }, '×'));
    }));
    if (!chosen.size) langChips.append(h('span.small.muted', 'لم تُختر لغة بعد'));
  }
  langSelect.addEventListener('change', () => {
    if (!langSelect.value) return;
    chosen.add(langSelect.value); drawLangs();
  });
  drawLangs();
  const langList = h('div.stack', { style: { gap: '10px' } }, langSelect, langChips);
  const langsHint = h('small.muted');
  const langsBox = h('fieldset', h('legend', 'لغات الترجمة'), langsHint, langList);
  const drawLangsBox = () => {
    const tr = f.applied_as.value === 'translator';
    langsHint.textContent = tr
      ? 'اختر اللغات التي تترجم إليها — لغة واحدة على الأقل.'
      : 'اختياري للمنسقين والإداريين: اتركها فارغة إن كنت لا تترجم.';
  };
  f.applied_as.addEventListener('change', drawLangsBox);
  drawLangsBox();
  const errs = errorsBox();
  const submit = h('button.btn.primary', { type: 'submit' }, 'إرسال طلب التسجيل');

  function validate() {
    const e = [];
    if (f.full_name.value.trim().length < 3) e.push('اكتب الاسم الكامل');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) e.push('البريد الإلكتروني غير صحيح');
    if (f.whatsapp.value && !/^\+?[0-9\s-]{8,16}$/.test(f.whatsapp.value.trim())) e.push('رقم واتس آب غير صحيح');
    const nid = f.national_id.value.trim();
    if (nid && !/^[12][0-9]{9}$/.test(nid)) e.push('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ (هوية) أو ٢ (إقامة)');
    if (f.applied_as.value === 'translator' && !chosen.size) e.push('اختر لغة ترجمة واحدة على الأقل');
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
          full_name: f.full_name.value.trim(), whatsapp: f.whatsapp.value.trim() || null,
          nationality: f.nationality.value.trim() || null, national_id: f.national_id.value.trim() || null,
          residence: f.residence.value.trim() || null, languages: [...chosen],
          applied_as: f.applied_as.value
        });
        // صورة الهوية: تُرفع فورًا إن فُتحت الجلسة، وإلا فعند أول دخول
        let note = '';
        const file = f.iqama.files[0];
        if (file && auth.session?.user?.id) {
          try {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
            const path = `${auth.session.user.id}/iqama-${Date.now()}.${ext}`;
            await storage.upload('private-docs', path, file);
            await db.update('profile_private', { id: `eq.${auth.session.user.id}` }, { iqama_path: path });
            note = 'ووصلت صورة الهوية.';
          } catch { note = 'ولم تُرفع صورة الهوية؛ ترفعها بعد أول دخول.'; }
        } else if (file) {
          note = 'وترفع صورة الهوية بعد تأكيد البريد وأول دخول.';
        }
        form.replaceWith(h('div.stack',
          h('h2', 'وصل طلبك'),
          h('p', `أرسلنا رابط تأكيد إلى بريدك. بعد التأكيد، يراجع المنسق طلبك ويفعّل حسابك، ثم تستطيع الدخول واستلام المهام. ${note}`),
          h('a.btn', { href: '/login' }, 'صفحة الدخول')));
      } catch (err) { showErrors(errs, [err.message]); }
    });
  } },
    h('h2', 'التسجيل في فريق الترجمة'),
    h('p.muted', 'هذا الرابط للمترجمين والمنسقين معًا. يُراجع الطلب ويُفعَّل الحساب، ثم يحدد مدير المشروع الدور. تُسند مهام المراجعة والتحرير لاحقًا حسب اللغة ولا تحتاج تسجيلًا منفصلًا.'),
    errs,
    h('label.field', 'أتقدّم بصفة', f.applied_as),
    h('div.grid-2',
      h('label.field', 'الاسم الكامل', f.full_name),
      h('label.field', 'البريد الإلكتروني', h('small', 'تدخل به إلى المنصة'), f.email),
      h('label.field', 'رقم واتس آب', f.whatsapp),
      h('label.field', 'الجنسية', f.nationality),
      h('label.field', 'رقم الهوية أو الإقامة', h('small', 'اختياري لمن يعمل من خارج المملكة'), f.national_id),
      h('label.field', 'مكان الإقامة', f.residence)),
    langsBox,
    h('div.grid-2',
      h('label.field', 'كلمة المرور', h('small', '٨ أحرف على الأقل'), f.password),
      h('label.field', 'تأكيد كلمة المرور', f.confirm)),
    h('label.field', 'صورة الهوية أو الإقامة', h('small', 'اختياري — صورة أو ملف PDF، ولا يطّلع عليها إلا المنسق ومدير المشروع'), f.iqama),
    h('label.check.top', f.consent, 'أقرّ بأن المعلومات التي أدخلتها صحيحة، وأن بياناتي تُستخدم لإدارة أعمال الترجمة في المشروع فقط، ولا يطّلع على الهوية والإقامة إلا المنسق ومدير المشروع.'),
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
