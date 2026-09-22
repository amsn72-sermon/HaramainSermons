// أدوات الواجهة: إنشاء العناصر، التنبيهات، النوافذ، وتنسيق الوقت

// h('div.card#x', {onclick, ...attrs}, ...children)
export function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i) || [];
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  // الوسيط الثاني خصائص فقط إن كان كائنًا عاديًا؛ غير ذلك (نص، رقم ولو صفرًا، عنصر، مصفوفة) فهو محتوى
  if (attrs === null || attrs === undefined || attrs === false) attrs = null;
  else if (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'required' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const frag = (...children) => { const f = document.createDocumentFragment(); append(f, children); return f; };
// يستبدل محتوى العنصر، ويقبل المصفوفات ويتجاهل الفراغات (بخلاف replaceChildren الأصلية)
export function fill(el, ...children) { el.replaceChildren(); append(el, children); return el; }

export function toast(message, kind = '') {
  const el = h('div.toast', { class: kind }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 4000);
}

// نافذة عامة: body عنصر، buttons [{label, kind, value}]
export function dialog({ title, body, buttons = [{ label: 'إغلاق', value: null }], onOpen }) {
  return new Promise(resolve => {
    const dlg = h('dialog', { 'aria-labelledby': 'dlg-title' },
      h('div.dlg-body', h('h3#dlg-title', title), body),
      h('div.dlg-foot', buttons.map(b => h('button.btn', {
        class: b.kind || '', type: 'button',
        onclick: async () => {
          if (b.validate) { const ok = await b.validate(); if (!ok) return; }
          dlg.close(); resolve(typeof b.value === 'function' ? b.value() : b.value);
        }
      }, b.label))));
    dlg.addEventListener('cancel', () => resolve(null));
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    document.body.append(dlg);
    dlg.showModal();
    onOpen && onOpen(dlg);
  });
}

export async function confirm(title, message, okLabel = 'تأكيد', kind = 'primary') {
  const v = await dialog({ title, body: h('p', message),
    buttons: [{ label: okLabel, kind, value: true }, { label: 'إلغاء', value: false }] });
  return v === true;
}

// ---------------------------------------------------------------------
// الوقت: أرقام لاتينية وتقويم ميلادي لمواعيد العمل؛ هجري للخطب
const dtFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

export const fmtDateTime = v => v ? dtFmt.format(new Date(v)) : '—';
export const fmtDate = v => v ? dFmt.format(new Date(v)) : '—';
export function fmtSermonDate(v) {
  if (!v) return '—';
  const d = new Date(v + 'T12:00:00');
  return `${hijriFmt.format(d)} (${dFmt.format(d)})`;
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Math.abs(totalSeconds)));
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const parts = [];
  if (d) parts.push(`${d} ي`);
  if (hh || d) parts.push(`${hh} س`);
  parts.push(`${mm} د`);
  if (!d && !hh) parts.push(`${ss} ث`);
  return parts.join(' ');
}
export function fmtMinutes(min) {
  const m = Math.round(min || 0);
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d && `${d} يوم`, hh && `${hh} ساعة`, (mm || (!d && !hh)) && `${mm} دقيقة`].filter(Boolean).join(' و ');
}

// عدّاد حيّ: يحدّث نفسه كل ثانية ويتوقف عند إزالته من الصفحة
export function countdown(dueAt, { soonMinutes = 15, prefix = true } = {}) {
  const el = h('span.timer');
  const tick = () => {
    if (!el.isConnected && el.dataset.started) { clearInterval(id); return; }
    el.dataset.started = '1';
    const diff = (new Date(dueAt) - Date.now()) / 1000;
    el.classList.toggle('late', diff < 0);
    el.classList.toggle('soon', diff >= 0 && diff < soonMinutes * 60);
    el.textContent = diff < 0 ? `متأخر ${fmtDuration(diff)}` : `${prefix ? 'متبقٍ ' : ''}${fmtDuration(diff)}`;
  };
  const id = setInterval(tick, 1000); tick();
  return el;
}

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loading(text = 'جارٍ التحميل…') { return h('div.empty', h('span', text)); }
export function emptyState(title, text, action) { return h('div.empty', h('b', title), text && h('span', text), action && h('div', { style: { marginTop: '12px' } }, action)); }

// يمنع النقر المزدوج على زر أثناء تنفيذ عملية
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}
