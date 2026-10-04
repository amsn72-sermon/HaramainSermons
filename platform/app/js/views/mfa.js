// التحقق بخطوتين برمز من تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator)
// إلزامي لمدير المشروع والمنسقين، واختياري لغيرهم (ملاحظة ١٠٣).
import { h, toast, busy } from '../ui.js';
import { auth, db } from '../sb.js';
import { state, isAdmin, loadMfaState } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';
import { qrSvgText } from '../qr.js';

const APPS = 'Google Authenticator أو Microsoft Authenticator أو أي تطبيق يدعم رموز TOTP';

// المضيُّ إلى الوجهة بتحميلٍ كامل: أضمنُ من الانتقال الداخلي بعد تبدُّل
// رمز الجلسة، فتُقرأ الحالُ كلُّها من جديد (ملاحظة ٢٠٩)
function goTo(ctx) {
  const next = ctx?.query?.get('next') || '/app';
  location.replace(next.startsWith('/') ? next : '/app');
}

// نصُّ otpauth بالمعيار: الجهةُ حروفٌ لاتينيةٌ بلا شرطاتٍ مائلة، والوسمُ
// «الجهة:الحساب»، وكلُّ جزءٍ مرمَّزٌ وحدَه — وهذا ما ترفض التطبيقاتُ ما خالفه
const ISSUER = 'Haramain Sermons';
export function otpauthUri(secret, account) {
  const e = encodeURIComponent;
  return `otpauth://totp/${e(ISSUER)}:${e(account)}`
    + `?secret=${encodeURIComponent(String(secret || '').replace(/\s+/g, ''))}`
    + `&issuer=${e(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
}

// رموز التطبيق تُحسب بالوقت: فارق يتجاوز نصف دقيقة يُبطلها كلها.
// يُقاس الفارق من ترويسة Date في رد الخادم نفسه (ملاحظة ١٠٣)
async function clockSkew() {
  try {
    const conf = window.HS_CONFIG || {};
    const base = conf.supabaseUrl;
    if (!base) return null;
    const t0 = Date.now();
    // الطلبُ بلا مفتاح الواجهة يُردّ بـ401 فيضيع الفحص (ملاحظة ٢١٠)
    const res = await fetch(`${String(base).replace(/\/+$/, '')}/auth/v1/settings`,
      { cache: 'no-store', headers: conf.supabaseAnonKey ? { apikey: conf.supabaseAnonKey } : {} });
    if (!res.ok) return null;
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
  await loadMfaState(true);
  // الاستيفاءُ يُؤخذ من البوابة لا من مستوى الرمز وحدَه (ملاحظة ٢٢٣)
  if (st.enrolled && state.mfaOk) return shell('التحقق بخطوتين مفعَّل', done(ctx));
  if (st.enrolled) return shell('التحقق بخطوتين', await askCode(ctx, st.verified[0]));
  // التفعيلُ بيد الإدارة لا بيد العضو: من لم يُلزَم به لا يفعّله لنفسه (ملاحظة ٢١٢)
  if (!mfaRequiredForMe()) return shell('التحقق بخطوتين', notYours());
  return shell('تفعيل التحقق بخطوتين', await enrollBox(ctx));
}

// أُلزم حسابُه بعينه، أو كان من الإدارة والإلزامُ عام — والمعفى لا يُطالَب (ملاحظة ٢٢٤)
const mfaRequiredForMe = () =>
  !state.mfaExempt
  && (state.profile?.mfa_required === true || (isAdmin() && state.mfaRequired !== false));

function notYours() {
  return h('div.stack',
    h('p', state.mfaExempt
      ? 'حسابُك معفًى من التحقق بخطوتين، فيُفتح بكلمة المرور وحدها.'
      : 'التحقق بخطوتين يُفعَّل لحسابك من إدارة المشروع، لا من هنا.'),
    h('p.small.muted', 'فإذا فُعّل لحسابك، طُلب منك تسجيلُ تطبيق المصادقة عند أول دخول، '
      + 'وعُرضت عليك رموزُ الاسترداد مرةً واحدة. وما دام لم يُفعَّل، فحسابُك يُفتح بكلمة المرور وحدها.'),
    h('div.row', h('a.btn.primary', { href: '/app' }, 'متابعة العمل')));
}

function done(ctx) {
  const left = h('p.small.muted', 'جارٍ عدّ رموز الاسترداد…');
  db.rpc('recovery_codes_left')
    .then(n => {
      const c = Number(n) || 0;
      left.className = c ? 'small muted' : 'small warn';
      left.textContent = c
        ? `بقي من رموز الاسترداد ${c} من ثمانية.`
        : 'لا رموز استرداد لحسابك — ولّدها الآن لئلا يُغلق عليك الباب إن فقدت جوالك.';
    })
    .catch(() => { left.textContent = ''; });

  const box = h('div.stack',
    h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'), 'حسابك محمي برمز من تطبيق المصادقة.'),
    left,
    h('div.row',
      h('a.btn.primary', { href: '/app' }, 'متابعة العمل'),
      h('button.btn', { type: 'button',
        onclick: () => showCodes(ctx, box) }, 'رموز استرداد جديدة')));
  return box;
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
      // تُكتب علامةُ الجلسة قبل أيِّ شيء: بها يُفتح البابُ ولو لم يرتفع
      // مستوى الرمز إلى aal2 (ملاحظة ٢٢٣)
      await db.rpc('mfa_mark_session').catch(() => {});
      await loadMfaState(true);
      toast('تم التحقق.', 'ok');
      // تحميلٌ كامل لا انتقالٌ داخلي: رمزُ الجلسة تبدّل، والرسمُ الداخلي
      // كان يسابق نفسَه فيبقى على الشاشة ما كان (ملاحظة ٢٠٩)
      goTo(ctx);
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
    h('p.small.muted', 'الرمز يتغيّر كل ثلاثين ثانية.'),
    recoveryBox(ctx));
}

// ---------------------------------------------------------------------
// رموزُ الاسترداد: مخرجُ من لا يصل إلى التطبيق (ملاحظة ٢٠٥)
// ---------------------------------------------------------------------
function recoveryBox(ctx) {
  const inp = h('input', { dir: 'ltr', placeholder: 'XXXXX-XXXXX', 'aria-label': 'رمز الاسترداد',
    autocomplete: 'off', spellcheck: 'false' });
  const go = h('button.btn', { type: 'button' }, 'استعمال الرمز');
  const err = h('div.form-errors', { hidden: true, role: 'alert' });
  go.onclick = () => busy(go, async () => {
    const v = inp.value.trim();
    if (v.replace(/[^0-9A-Za-z]/g, '').length < 6) {
      err.replaceChildren(h('ul', h('li', 'اكتب رمز الاسترداد كما حفظته'))); err.hidden = false; return;
    }
    try {
      const ok = await db.rpc('use_recovery_code', { p_code: v });
      if (ok === true || ok === 'true') {
        toast('قُبل رمز الاسترداد، وسقط التسجيل القديم. سجّل التطبيق من جديد.', 'ok');
        await loadMfaState(true);
        location.reload();
      } else {
        err.replaceChildren(h('ul', h('li', 'هذا الرمز غير صحيح أو سبق استعماله.')));
        err.hidden = false; inp.value = '';
      }
    } catch (e) {
      err.replaceChildren(h('ul', h('li', e.message))); err.hidden = false;
    }
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });

  return h('details.mfa-recovery',
    h('summary', 'لا تصل إلى تطبيق المصادقة؟'),
    h('p.small', 'استعمل أحد رموز الاسترداد التي عُرضت عليك يوم التفعيل. '
      + 'يُستعمل الرمز مرةً واحدة، ويُسقط التسجيل القائم فتسجّل التطبيق من جديد.'),
    err,
    h('div.mfa-row', inp, go),
    h('p.small.muted', 'وإن فقدت الرموز والجوال معًا فمدير المشروع يمسح التسجيل من شاشة الفريق.'));
}

// عرضُ الرموز مرةً واحدةً بعد التفعيل، ولا سبيل إلى استعادتها بعدها
async function showCodes(ctx, box) {
  let codes = [];
  try {
    const out = await db.rpc('make_recovery_codes');
    codes = (Array.isArray(out) ? out : []).map(r => (typeof r === 'string' ? r : r?.make_recovery_codes)).filter(Boolean);
  } catch { /* لا يمنع الدخول */ }
  if (!codes.length) { goTo(ctx); return; }

  const kept = h('input', { type: 'checkbox', 'aria-label': 'حفظت الرموز' });
  const next = h('button.btn.primary', { type: 'button', disabled: true }, 'متابعة العمل');
  kept.onchange = () => { next.disabled = !kept.checked; };
  next.onclick = () => goTo(ctx);

  const copy = h('button.btn', { type: 'button' }, 'نسخ الرموز');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast('نُسخت الرموز.', 'ok'); }
    catch { toast('تعذّر النسخ — انسخها يدويًّا.', 'bad'); }
  };
  const print = h('button.btn', { type: 'button', onclick: () => window.print() }, 'طباعة');

  box.replaceChildren(
    h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'), 'فُعّل التحقق بخطوتين.'),
    h('h3', 'رموز الاسترداد'),
    h('p', 'ثمانية رموز، كلٌّ منها يُستعمل مرةً واحدة. احفظها في مكان آمن خارج جوالك: '
      + 'بها تدخل إن فقدت الجوال أو حذفت الحساب من التطبيق.'),
    h('p.small.warn', 'تُعرض الآن ولا تُعرض بعدها أبدًا — فلا يُحفظ منها عندنا إلا بصمتُها.'),
    h('ol.mfa-codes', { dir: 'ltr' }, codes.map(c => h('li', h('code', c)))),
    h('div.row', copy, print),
    h('label.check', kept, h('span', 'حفظتُ الرموز في مكان آمن')),
    h('div.row', next));
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
    const secret = f.totp?.secret || '';
    const img = h('div.mfa-qr');
    // الرمزُ الواصلُ من خادم الحسابات كانت تطبيقاتُ المصادقة ترفضه، لأن الجهة
    // (issuer) فيه عنوانُ موقعٍ كاملٌ بشرطتين مائلتين فينكسر مسارُ otpauth.
    // فنبنيه هنا من المفتاح نفسِه بنصٍّ نظيفٍ مرمَّز، وحافةٍ بيضاء أربعِ وحدات
    // كما يوجب المعيار (ملاحظة ٢٠٤)
    const uri = otpauthUri(secret, auth.user?.email || state.profile?.full_name || 'حساب');
    if (secret) {
      img.innerHTML = qrSvgText(uri, { margin: 4 });
    } else {
      const qr = f.totp?.qr_code || '';
      if (qr.startsWith('<')) img.innerHTML = qr; else img.append(h('img', { src: qr, alt: 'رمز التسجيل' }));
    }

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
        // تسجيلٌ واحدٌ للحساب: ما سبق من عوامل يسقط، فلا يجتمع في التطبيق
        // سجلّانِ لا يُدرى أيُّهما العامل (ملاحظة ٢٢٥)
        await db.rpc('mfa_keep_one_factor', { p_keep: f.id }).catch(() => {});
        await db.rpc('mfa_mark_session').catch(() => {});
        await loadMfaState(true);
        await showCodes(ctx, box);        // الرموزُ تُعرض مرةً واحدة قبل المتابعة
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
        'لكل فتحةٍ لهذه الصفحة رمزٌ جديد. فإن حدّثتها أو عدت إليها فامسح الرمز الظاهر الآن، ',
        'وأدخل الرقم فور ظهوره فهو يتغيّر كل ثلاثين ثانية. ',
        'ومتى نجح التفعيلُ سقط تسجيلُك السابق عندنا، فلحسابك سجلٌّ واحدٌ لا غير — ',
        'واحذف من التطبيق ما بقي من سجلّاتٍ قديمةٍ لهذا الحساب فهي لا تعمل. ',
        'وتأكّد أن ساعة جوالك مضبوطة تلقائيًّا.'),
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
    box.replaceChildren(enrollFailure(e));
  }
  return box;
}

// سببُ الإخفاق يُبيَّن ليُعالَج: فخادمُ الحسابات قد يكون التحققُ بخطوتين
// معطَّلًا فيه، وهي حالٌ لا يصلحها العضو ولا يفهمها من رسالةٍ مبهمة.
function enrollFailure(e) {
  const raw = String(e?.message || '');
  const off = /not\s*enabled|disabled|unsupported|not\s*found|404|501/i.test(raw);
  const many = /maximum|limit|too many/i.test(raw);
  const auth401 = /401|unauthor|jwt|token/i.test(raw);

  const why = off
    ? ['خادمُ الحسابات لا يُتيح التحقق بخطوتين الآن.',
       'وهذا إعدادٌ في الخادم لا في حسابك: يُفعَّل التحقق بخطوتين في خدمة الحسابات '
       + '(GoTrue) ثم تُعاد المحاولة. أبلغ مدير المشروع بهذه الرسالة.']
    : many
      ? ['بلغ حسابُك أقصى عدد من أجهزة التحقق المسجَّلة.',
         'احذف جهازًا قديمًا من حسابك ثم أعد المحاولة.']
      : auth401
        ? ['انتهت جلستُك قبل تجهيز الرمز.',
           'اخرج ثم ادخل من جديد، وأعد المحاولة فورًا.']
        : ['تعذّر تجهيز رمز التسجيل.',
           'أعد تحميل الصفحة، فإن تكرّر فأبلغ مدير المشروع بالرسالة أدناه.'];

  return h('div.stack',
    h('div.form-errors', { role: 'alert' },
      h('b', why[0]), h('p.small', why[1]),
      raw ? h('p.small.muted', { dir: 'ltr' }, raw) : null),
    h('div.row',
      h('button.btn', { type: 'button', onclick: () => location.reload() }, 'إعادة المحاولة'),
      h('a.btn', { href: '/app' }, 'العودة')));
}
