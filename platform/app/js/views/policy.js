// شاشة سياسة السرية: تُعرض عند أول دخول بعد التفعيل، ولا يُتجاوزها إلا بالتوقيع (ملاحظة ٥٧)
import { h, toast, busy, fmtDate } from '../ui.js';
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
