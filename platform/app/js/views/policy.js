// شاشة سياسة السرية: تُعرض عند أول دخول بعد التفعيل، ولا يُتجاوزها إلا بالتوقيع (ملاحظة ٥٧)
import { h, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db, auth } from '../sb.js';
import { state } from '../store.js';
import { brand, themeToggle, footer } from './shell.js';
import { POLICY_KEY, POLICY_VERSION, POLICY_TITLE, POLICY_INTRO, POLICY_SECTIONS, POLICY_ACK } from '../policy.js';

export function policyText() {
  return h('div.policy-text',
    h('p.muted', POLICY_INTRO),
    POLICY_SECTIONS.map(([title, items]) =>
      h('section', h('h3', title), h('ul', items.map(t => h('li', t))))));
}

// عرض السياسة كاملة من الزر الدائم؛ ومن لم يوقّع يستطيع التوقيع من هنا (ملاحظة ٧٦)
export async function policyDialog() {
  const { dialog } = await import('../ui.js');
  const signed = !!state.policySigned;
  const agree = h('input', { type: 'checkbox' });
  const name = h('input', { autocomplete: 'off', placeholder: state.profile?.full_name || 'اكتب اسمك الكامل' });
  let stamp = null;
  if (signed) {
    try {
      const rows = await db.select('policy_acceptances', {
        select: 'signed_name,policy_version,accepted_at',
        member_id: `eq.${state.profile.id}`, policy_key: `eq.${POLICY_KEY}`, order: 'accepted_at.desc', limit: 1
      });
      stamp = rows[0] || null;
    } catch { /* العرض لا يتوقف على السجل */ }
  }
  const res = await dialog({
    title: POLICY_TITLE,
    body: h('div.stack',
      h('div.policy-state', { class: signed ? 'signed' : 'unsigned' },
        signed
          ? `تم التوقيع${stamp ? ` باسم «${stamp.signed_name}» في ${fmtDateTime(stamp.accepted_at)} — النسخة ${stamp.policy_version}` : ''}`
          : 'لم توقّع على هذه السياسة بعد'),
      h('p.small.muted', `النسخة ${POLICY_VERSION}`),
      policyText(),
      signed ? null : h('div.stack',
        h('label.check.top', agree, h('span', POLICY_ACK)),
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
    await db.rpc('accept_policy', { p_version: POLICY_VERSION, p_name: res, p_key: POLICY_KEY });
    state.policySigned = true;
    toast('شكرًا لك، سُجّل توقيعك.', 'ok');
    return true;
  } catch (err) { toast(err.message, 'bad'); return false; }
}

export async function render(ctx) {
  const me = state.profile;
  const agree = h('input', { type: 'checkbox' });
  const name = h('input', { autocomplete: 'off', placeholder: me?.full_name || 'اكتب اسمك الكامل' });
  const sign = h('button.btn.primary', { type: 'button' }, 'أوافق وأوقّع');

  sign.onclick = () => busy(sign, async () => {
    if (!agree.checked) return toast('ضع علامة الإقرار أولًا.', 'bad');
    const typed = name.value.trim();
    if (typed.length < 3) return toast('اكتب اسمك الكامل توقيعًا.', 'bad');
    try {
      await db.rpc('accept_policy', { p_version: POLICY_VERSION, p_name: typed, p_key: POLICY_KEY });
      state.policySigned = true;
      toast('شكرًا لك، سُجّل توقيعك.', 'ok');
      ctx.navigate('/app', { replace: true });
    } catch (err) { toast(err.message, 'bad'); }
  });

  return h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/app'), h('div.spacer'), themeToggle())),
    h('main#main.auth-wrap', { tabindex: '-1' },
      h('div.card.auth-card.stack', { style: { maxWidth: '820px' } },
        h('div', h('div.eyebrow', 'قبل البدء'), h('h2', POLICY_TITLE),
          h('p.small.muted', `النسخة ${POLICY_VERSION} — ${fmtDate(new Date())}`)),
        policyText(),
        h('label.check.top', agree, h('span', POLICY_ACK)),
        h('label.field', 'التوقيع: اكتب اسمك الكامل', name),
        h('div.row', sign,
          h('button.btn', { type: 'button', onclick: async () => { await auth.signOut(); ctx.navigate('/login', { replace: true }); } }, 'خروج')),
        h('p.small.muted', 'يُحفظ توقيعك باسمك ونسخة السياسة وتاريخ الموافقة، ويمكن لإدارة المشروع الاطلاع عليه.'))),
    footer());
}
