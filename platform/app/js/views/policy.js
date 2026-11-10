// شاشة الميثاق: تُعرض عند أول دخول بعد التفعيل، ولا يُتجاوزها إلا بالتوقيع (ملاحظة ٥٧)
//
//   وميثاقُ العضو يتبع فريقَه (ملاحظة ٤٨١): أهلُ الميدان — الإرشادِ
//   المكانيِّ وإجابةِ السائلين — على «ميثاق العمل الميداني»، وسائرُ
//   الفريق على «ميثاق العمل». فلا تُعرَض على أحدٍ بنودُ غيره.
import { h, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db, auth } from '../sb.js';
import { state } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';
import { POLICY_KEY, POLICY_VERSION, charterOf, charterDoc, hasCharterVersion,
         policyPlainText } from '../policy.js';

// ميثاقُ العضو الحاليِّ: مفتاحُه ونسختُه ونصُّه
const mine = () => charterOf(state.profile);

// نصُّ نسخةٍ بعينها من ميثاقٍ بعينه: ومن وقَّع على نسخةٍ عُرِضت عليه
//   نسختُه هي لا ما استُحدث بعدها (ملاحظة ٤٢٥)
export function policyText(version = POLICY_VERSION, key = POLICY_KEY) {
  const p = charterDoc(key, version);
  return h('div.policy-text',
    h('p.muted', p.intro),
    p.sections.map(([title, items]) =>
      h('section', h('h3', title), h('ul', items.map(t => h('li', t))))));
}

// عرض السياسة كاملة من الزر الدائم؛ ومن لم يوقّع يستطيع التوقيع من هنا (ملاحظة ٧٦)
export async function policyDialog() {
  const { dialog } = await import('../ui.js');
  const ch = mine();
  const signed = !!state.policySigned;
  const agree = h('input', { type: 'checkbox' });
  const name = h('input', { autocomplete: 'off', placeholder: state.profile?.full_name || 'اكتب اسمك الكامل' });
  // سجلُّ توقيعه يُقرأ دائمًا: فمن وقَّع نسخةً سابقةً ليس «موقِّعًا» عند
  //   البوّابة، ومع ذلك له توقيعٌ قائمٌ ووثيقةُ إثباتٍ ونصُّ نسخةٍ
  //   يُحتجُّ به عليه (ملاحظة ٤٨٥)
  let stamp = null;
  if (state.profile) {
    try {
      const rows = await db.select('policy_acceptances', {
        select: 'signed_name,policy_version,accepted_at,proof_code',
        member_id: `eq.${state.profile.id}`, policy_key: `eq.${ch.key}`, order: 'accepted_at.desc', limit: 1
      });
      stamp = rows[0] || null;
    } catch { /* العرض لا يتوقف على السجل */ }
  }
  const res = await dialog({
    title: ch.doc.title,
    body: h('div.stack',
      h('div.policy-state', { class: signed ? 'signed' : 'unsigned' },
        signed
          ? `تم التوقيع${stamp ? ` باسم «${stamp.signed_name}» في ${fmtDateTime(stamp.accepted_at)} — النسخة ${stamp.policy_version}` : ''}`
          : stamp
            ? `وقَّعتَ النسخة ${stamp.policy_version}، وتُطالَب بالنسخة الجارية ${ch.version}`
            : 'لم توقّع على هذا الميثاق بعد'),
      h('p.small.muted', `النسخةُ الجارية ${ch.version}`
        + (stamp && stamp.policy_version !== ch.version
          ? ` — ووقَّعتَ النسخة ${stamp.policy_version}` : '')),
      // وثيقةُ إثبات توقيعه بين يديه (ملاحظة ٤٢٧)
      stamp
        ? h('div.row.wrap',
            h('button.btn.sm', { type: 'button',
              onclick: async ev => busy(ev.currentTarget, async () => {
                const m = await import('../sigproof.js');
                await m.proofFor(state.profile.id, stamp.policy_version, ch.key);
              }) }, '🖨 وثيقةُ إثبات توقيعي'),
            stamp.proof_code
              ? h('span.small.muted', { dir: 'ltr', style: { alignSelf: 'center' } }, stamp.proof_code)
              : null)
        : null,
      // النصُّ المعروضُ هو النسخةُ الجاريةُ — فهي المعمولُ بها اليوم.
      //   ونسخةُ الموقِّع تبقى بين يديه مطويّةً تحتها، فيُحتجُّ عليه
      //   بنصِّه هو ولا يُحسَب أنَّ المعروضَ عليه قديم (ملاحظة ٤٨٥)
      policyText(ch.version, ch.key),
      stamp && stamp.policy_version !== ch.version && hasCharterVersion(ch.key, stamp.policy_version)
        ? h('details.cd-more',
            h('summary', `نصُّ النسخة التي وقَّعتَها — ${stamp.policy_version}`),
            h('div.stack',
              h('p.small.muted', 'هذا نصُّ نسختك الموقَّعة، وهو المحتجُّ به عليك '
                + 'فيما كان قبل النسخة الجارية. وأمّا الجاريةُ فهي المعروضةُ أعلاه، '
                + 'وتُطالَب بتوقيعها.'),
              policyText(stamp.policy_version, ch.key)))
        : null,
      signed ? null : h('div.stack',
        h('label.check.top', agree, h('span', ch.doc.ack)),
        h('label.field', 'التوقيع: اكتب اسمك الكامل', name))),
    buttons: signed
      ? [{ label: 'إغلاق', value: null }]
      : [{ label: 'أوافق وأوقّع', kind: 'primary', validate: () => {
            if (!agree.checked) { toast('ضع علامة الإقرار أولًا.', 'bad'); return false; }
            if (name.value.trim().length < 3) { toast('اكتب اسمك الكامل توقيعًا.', 'bad'); return false; }
            return true;
          }, value: () => name.value.trim() },
          { label: 'إغلاق', value: null }]
  });
  if (!res) return false;
  try {
    // النصُّ يُرسَل كما عُرِض، فتُحسَب بصمتُه في الخادم (ملاحظة ٤٢٥)
    await db.rpc('accept_policy', { p_version: ch.version, p_name: res,
      p_key: ch.key, p_text: policyPlainText(ch.version, ch.key) });
    state.policySigned = true;
    toast('شكرًا لك، سُجّل توقيعك.', 'ok');
    return true;
  } catch (err) { toast(err.message, 'bad'); return false; }
}

export async function render(ctx) {
  const me = state.profile;
  const ch = mine();
  const agree = h('input', { type: 'checkbox' });
  const name = h('input', { autocomplete: 'off', placeholder: me?.full_name || 'اكتب اسمك الكامل' });
  const sign = h('button.btn.primary', { type: 'button' }, 'أوافق وأوقّع');

  sign.onclick = () => busy(sign, async () => {
    if (!agree.checked) return toast('ضع علامة الإقرار أولًا.', 'bad');
    const typed = name.value.trim();
    if (typed.length < 3) return toast('اكتب اسمك الكامل توقيعًا.', 'bad');
    try {
      await db.rpc('accept_policy', { p_version: ch.version, p_name: typed,
        p_key: ch.key, p_text: policyPlainText(ch.version, ch.key) });
      state.policySigned = true;
      toast('شكرًا لك، سُجّل توقيعك.', 'ok');
      ctx.navigate('/app', { replace: true });
    } catch (err) { toast(err.message, 'bad'); }
  });

  return h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/app'), h('div.spacer'), themeToggle())),
    h('main#main.auth-wrap', { tabindex: '-1' },
      h('div.card.auth-card.stack', { style: { maxWidth: '820px' } },
        h('div', h('div.eyebrow', 'قبل البدء'), h('h2', ch.doc.title),
          h('p.small.muted', `النسخة ${ch.version} — ${fmtDate(new Date())}`)),
        policyText(ch.version, ch.key),
        h('label.check.top', agree, h('span', ch.doc.ack)),
        h('label.field', 'التوقيع: اكتب اسمك الكامل', name),
        h('div.row', sign,
          h('button.btn', { type: 'button', onclick: async () => { await auth.signOut(); ctx.navigate('/login', { replace: true }); } }, 'خروج')),
        h('p.small.muted', 'يُحفظ توقيعك باسمك ونسخة الميثاق ووقت الموافقة، ومعه عنوان شبكتك '
          + 'ووصف جهازك وبصمة النصّ الذي عُرض عليك — إثباتًا للتوقيع. ويمكن لإدارة المشروع '
          + 'الاطلاع عليه وطبع وثيقة إثبات به.'))),
    footer());
}
