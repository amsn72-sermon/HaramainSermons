// تنقية HTML بقائمة سماح صارمة: أي وسم أو سمة غير مدرجة تُحذف.
// تُستخدم قبل الحفظ وقبل العرض، فلا يمر نص مُدرج من خارج المحرر كما هو.
const TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'H2', 'H3', 'SPAN', 'DIV', 'BLOCKQUOTE', 'FONT',
  'SUP', 'SUB', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH']);
const STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'direction', 'font-weight', 'font-style', 'text-decoration', 'font-size', 'font-family',
  'line-height', 'margin-left', 'margin-right', 'padding-left', 'padding-right', 'text-indent', 'vertical-align']);
const SAFE_VALUE = /^[#a-z0-9(),.%\s'"-]+$/i;
// الأسود يختفي في المظهر الداكن والأبيض يصنع رقعًا في الفاتح: يُترك لون النص للصفحة
const INK = /^(#000(000)?|black|windowtext|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*1(\.0*)?\s*)?\)|initial|inherit|currentcolor)$/i;
const PAPER = /^(#fff(fff)?|white|window|transparent|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1(\.0*)?\s*)?\)|rgba\(.*,\s*0\s*\)|initial|inherit)$/i;

function cleanStyle(style) {
  const out = [];
  for (const decl of String(style || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !SAFE_VALUE.test(val) || /url|expression/i.test(val)) continue;
    if (prop === 'color' && INK.test(val)) continue;
    if (prop === 'background-color' && PAPER.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

function walk(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
    if (!TAGS.has(child.tagName)) {
      // وسم غير مسموح: نُبقي نصه إن كان وسمًا نصيًا، ونحذف ما عدا ذلك بمحتواه
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'svg', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT'].includes(child.tagName)) { child.remove(); continue; }
      walk(child);
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const n = attr.name.toLowerCase();
      if (n === 'style') { const s = cleanStyle(attr.value); s ? child.setAttribute('style', s) : child.removeAttribute('style'); }
      else if (n === 'dir' && /^(rtl|ltr|auto)$/i.test(attr.value)) continue;
      else if (n === 'align' && /^(right|left|center|justify)$/i.test(attr.value)) continue;
      else if (child.tagName === 'FONT' && (n === 'color' || n === 'face' || n === 'size') && SAFE_VALUE.test(attr.value) && !(n === 'color' && INK.test(attr.value.trim()))) continue;
      else if ((child.tagName === 'TD' || child.tagName === 'TH') && (n === 'colspan' || n === 'rowspan') && /^[1-9][0-9]?$/.test(attr.value)) continue;
      else child.removeAttribute(attr.name);
    }
    walk(child);
  }
}

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  walk(doc.body);
  return doc.body.innerHTML;
}

export function plainText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

// عرض HTML منقّى داخل عنصر
export function setSafeHtml(el, html) { el.innerHTML = sanitize(html); return el; }
