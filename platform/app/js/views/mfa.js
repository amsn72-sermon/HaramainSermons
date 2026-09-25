// التحقق بخطوتين برمز من تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator)
// إلزامي لمدير المشروع والمنسقين، واختياري لغيرهم (ملاحظة ١٠٣).
import { h, toast, busy } from '../ui.js';
import { auth } from '../sb.js';
import { state, isAdmin, loadMfaState } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';

const APPS = 'Google Authenticator أو Microsoft Authenticator أو أي تطبيق يدعم رموز TOTP';

// رموز التطبيق تُحسب بالوقت: فارق يتجاوز نصف دقيقة يُبطلها كلها.
// يُقاس الفارق من ترويسة Date في رد الخادم نفسه (ملاحظة ١٠٣)
async function clockSkew() {
  try {
    const base = (window.HS_CONFIG || {}).supabaseUrl;
    if (!base) return null;
    const t0 = Date.now();
    const res = await fetch(`${base}/auth/v1/settings`, { cache: 'no-store' });
    const head = res.headers.get('date');
    if (!head) return null;
    const rtt = (Date.now() - t0) / 2;
    return Math.round((Date.parse(head) + rtt - Date.now()) / 1000);
  } catch { return null; }
}

function skewWarning(sec) {
  if (sec === null || Math.abs(sec) < 25) return null;
  return h('div.form-errors', { role: 'alert' },
    h('ul', h('li', h('b', 'فرق في الساعة: '),
      `ساعة هذا الجهاز تسبق ساعة الخادم أو تتأخر عنها بنحو ${Math.abs(sec)} ثانية، `,
      'ورموز التطبيق تُحسب بالوقت فلن تُقبل حتى يُضبط. اضبط ساعة الجهاز تلقائيًّا، ',
      'وإن بقي الفارق فالخلل في ساعة الخادم.')));
}

// حالة التحقق للمستخدم الحالي: هل له عامل مؤكَّد، وهل بلغت الجلسة مستوى aal2
export async function mfaState() {
  try {
    const list = await auth.mfa.factors();
    const verified = auth.mfa.verified(list);
    return { list, verified, enrolled: verified.length > 0, satisfied: auth.aal === 'aal2' };
  } catch { return { list: [], verified: [], enrolled: false, satisfied: auth.aal === 'aal2' }; }
}

// إدخال ستة أرقام
function codeInput(label = 'الرمز من التطبيق') {
  const el = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', dir: 'ltr',
    maxlength: 6, placeholder: '000000', 'aria-label': label });
  el.addEventListener('input', () => { el.value = el.value.replace(/[^0-9]/g, '').slice(0, 6); });
  return el;
}

const shell = (title, body) => h('div',
  h('header.topbar', h('div.inner', brand(undefined, undefined, '/app'), h('div.spacer'), themeToggle())),
  h('main#main.auth-wrap', { tabindex: '-1' },
    h('div.card.auth-card.stack', { style: { maxWidth: '620px' } },
      h('div', h('div.eyebrow', 'حماية الحساب'), h('h2', title)),
      body)),
  footer());

// ---------------------------------------------------------------------
// الشاشة: تطلب الرمز لمن سجّل التطبيق، وتطلب التسجيل ممن لم يسجّل
// ---------------------------------------------------------------------
export async function render(ctx) {
  const st = await mfaState();
  if (st.satisfied && st.enrolled) return shell('التحقق بخطوتين مفعَّل', done(ctx));
  return st.enrolled ? shell('التحقق بخطوتين', await askCode(ctx, st.verified[0]))
                     : shell('تفعيل التحقق بخطوتين', await enrollBox(ctx));
}

function done(ctx) {
  return h('div.stack',
    h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'), 'حسابك محمي برمز من تطبيق المصادقة.'),
    h('div.row', h('a.btn.primary', { href: '/app' }, 'متابعة العمل')));
}

// إدخال الرمز عند الدخول
async function askCode(ctx, factor) {
  const code = codeInput();
  const go = h('button.btn.primary', { type: 'button' }, 'تأكيد الرمز');
  const err = h('div.form-errors', { hidden: true, role: 'alert' });
  const submit = () => busy(go, async () => {
    if (code.value.length !== 6) { err.replaceChildren(h('ul', h('li', 'الرمز ستة أرقام'))); err.hidden = false; return; }
    try {
      const ch = await auth.mfa.challenge(factor.id);
      await auth.mfa.verify(factor.id, ch.id, code.value);
      await loadMfaState(true);
      toast('تم التحقق.', 'ok');
      ctx.navigate(ctx.query?.get('next') || '/app', { replace: true });
    } catch (e) {
      err.replaceChildren(h('ul',
        h('li', /invalid|expired/i.test(e.message) ? 'رمز غير صحيح أو انتهت صلاحيته — جرّب الرمز الجديد.' : e.message),
        h('li.small.muted', { dir: 'ltr' }, e.message)));
      err.hidden = false;
      code.value = ''; code.focus();
    }
  });
  go.onclick = submit;
  code.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  setTimeout(() => code.focus(), 60);

  const skewBox = h('div');
  clockSkew().then(sec => { const w = skewWarning(sec); if (w) skewBox.replaceChildren(w); });

  return h('div.stack',
    h('p.muted', `افتح تطبيق المصادقة على جوالك واكتب الرمز الظاهر لحساب «${state.profile?.full_name || auth.user?.email || ''}».`),
    skewBox,
    err,
    h('label.field', 'الرمز (ستة أرقام)', code),
    h('div.row', go,
      h('button.btn', { type: 'button', onclick: async () => { await auth.signOut(); ctx.navigate('/login', { replace: true }); } }, 'خروج')),
    h('p.small.muted', 'الرمز يتغيّر كل ثلاثين ثانية. وإن فقدت جوالك فراجع مدير المشروع لإلغاء التطبيق المسجَّل وإعادة تفعيله.'));
}

// تسجيل التطبيق أول مرة: رمز QR ثم تأكيد برمز
async function enrollBox(ctx) {
  const box = h('div.stack', h('p.muted', 'جارٍ تجهيز رمز التسجيل…'));
  const required = isAdmin();

  try {
    // محاولة سابقة لم تكتمل تترك عاملًا غير مؤكَّد يمنع التسجيل: يُزال أولًا
    try {
      const old = await auth.mfa.factors();
      for (const f of old.filter(x => x.status !== 'verified')) await auth.mfa.unenroll(f.id).catch(() => {});
    } catch { /* لا يمنع التسجيل */ }
    const stamp = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn');
    const f = await auth.mfa.enroll(`${state.profile?.full_name || 'حساب'} — ${stamp} ${Math.random().toString(36).slice(2, 5)}`);
    const qr = f.totp?.qr_code || '';
    const secret = f.totp?.secret || '';
    const img = h('div.mfa-qr');
    // رمز QR يصل من الخادم صورة SVG جاهزة
    if (qr.startsWith('<')) img.innerHTML = qr; else img.append(h('img', { src: qr, alt: 'رمز التسجيل' }));

    const code = codeInput('رمز التأكيد');
    const err = h('div.form-errors', { hidden: true, role: 'alert' });
    const skewBox = h('div');
    clockSkew().then(sec => { const w = skewWarning(sec); if (w) skewBox.replaceChildren(w); });
    const go = h('button.btn.primary', { type: 'button' }, 'تأكيد وتفعيل');
    const submit = () => busy(go, async () => {
      if (code.value.length !== 6) { err.replaceChildren(h('ul', h('li', 'الرمز ستة أرقام'))); err.hidden = false; return; }
      try {
        const ch = await auth.mfa.challenge(f.id);
        await auth.mfa.verify(f.id, ch.id, code.value);
        await loadMfaState(true);
        toast('فُعّل التحقق بخطوتين.', 'ok');
        ctx.navigate(ctx.query?.get('next') || '/app', { replace: true });
      } catch (e) {
        const skew = await clockSkew();
        err.replaceChildren(h('ul',
          h('li', /invalid|expired/i.test(e.message) ? 'رمز غير صحيح — جرّب الرمز الجديد في التطبيق.' : e.message),
          skew !== null && Math.abs(skew) >= 25
            ? h('li', h('b', 'والسبب على الأرجح: '), `فرق ${Math.abs(skew)} ثانية بين ساعة هذا الجهاز وساعة الخادم.`)
            : null,
          h('li.small.muted', { dir: 'ltr' }, e.message)));
        err.hidden = false; code.value = ''; code.focus();
      }
    });
    go.onclick = submit;
    code.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

    box.replaceChildren(
      h('p.muted', required
        ? 'حسابك إداري، فالتحقق بخطوتين إلزامي عليه: لا تُفتح المنصة إلا برمز من تطبيق المصادقة على جوالك.'
        : 'تُضيف هذه الخطوة رمزًا من جوالك إلى كلمة المرور، فلا يدخل حسابك أحد بكلمة المرور وحدها.'),
      h('ol.mfa-steps',
        h('li', `ثبّت على جوالك ${APPS}.`),
        h('li', 'افتح التطبيق واختر «مسح رمز QR»، ثم وجّه الكاميرا إلى الرمز أدناه.'),
        h('li', 'اكتب الرمز السداسي الظاهر في التطبيق هنا، واضغط «تأكيد وتفعيل».')),
      h('p.small.muted',
        'لكل فتحة لهذه الصفحة رمز جديد: إن حدّثتها أو عدت إليها، فاحذف السجل القديم من التطبيق وامسح الرمز الظاهر الآن، ',
        'ثم أدخل الرمز فور ظهوره فهو يتغيّر كل ثلاثين ثانية. وتأكّد أن ساعة جوالك مضبوطة تلقائيًّا.'),
      img,
      secret ? h('details.mfa-secret', h('summary', 'تعذّر مسح الرمز؟ أدخل المفتاح يدويًّا'),
        h('p.small', 'في التطبيق اختر «إدخال مفتاح الإعداد» ثم الصق:'),
        h('code', { dir: 'ltr' }, secret)) : null,
      skewBox,
      err,
      h('label.field', 'الرمز من التطبيق', code),
      h('div.row', go,
        h('button.btn', { type: 'button', onclick: async () => { await auth.signOut(); ctx.navigate('/login', { replace: true }); } }, 'خروج')));
  } catch (e) {
    box.replaceChildren(h('p.small.bad', e.message || 'تعذّر تجهيز رمز التسجيل'),
      h('div.row', h('a.btn', { href: '/app' }, 'العودة')));
  }
  return box;
}
