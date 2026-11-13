// تنقية HTML بقائمة سماح صارمة: أي وسم أو سمة غير مدرجة تُحذف.
// تُستخدم قبل الحفظ وقبل العرض، فلا يمر نص مُدرج من خارج المحرر كما هو.
const TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'H2', 'H3', 'SPAN', 'DIV', 'BLOCKQUOTE', 'FONT',
  'SUP', 'SUB', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH']);
// ـــ توحيدُ خطِّ المتن: المقاسُ والتباعدُ والخطُّ من الكليشة لا من
//   الصقِّ ولا من اختيار المترجم (ملاحظة ٤٩٩)
//
//   تُركت الحريةُ للمترجمين في المقاس فجاء بعضُهم بعشرين وبعضُهم
//   بأربعة عشر، فاختلفت الورقةُ عن الورقة في عملٍ واحد. والنصُّ يُلصَق
//   من وورد فيحمل معه مقاساتِ مصدره وخطوطَه. فصارت هذه الخصائصُ تُنزَع
//   عند الحفظ والعرض جميعًا، ويبقى المقاسُ واحدًا في المنصة والطباعة.
const STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'direction', 'font-weight', 'font-style', 'text-decoration',
  'margin-left', 'margin-right', 'padding-left', 'padding-right', 'text-indent', 'vertical-align']);
const SAFE_VALUE = /^[#a-z0-9(),.%\s'"-]+$/i;
// الصفوفُ المسموحةُ في متن الترجمة: صندوقُ الآية وترجمتُها (ملاحظة ٥٠٠)
const CLASSES = new Set(['aya', 'aya-tr', 'aya-ref']);
// الورقة بيضاء دائمًا: نحذف النص الأبيض (يختفي) والخلفية البيضاء (رقع)
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
    if (prop === 'color' && PAPER.test(val)) continue;   // أبيض على ورقة بيضاء = نص مختفٍ
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
      // ـــ صفوفٌ معدودةٌ تبقى: صندوقُ الآية وترجمتُها ومرجعُها
      //   (ملاحظتا ٤٩٩ و٥٠٠)، وما عداها يسقط
      else if (n === 'class') {
        const keep = String(attr.value || '').split(/\s+/).filter(c => CLASSES.has(c));
        if (keep.length) child.setAttribute('class', keep.join(' '));
        else child.removeAttribute('class');
      }
      // ومرجعُ الآية يُحفَظ معها ليُراجَع في الخادم: «سورة:آية» أو مداها
      else if (n === 'data-aya'
        && /^\d{1,3}:\d{1,3}(-\d{1,3})?(,\d{1,3}:\d{1,3}(-\d{1,3})?)*$/.test(attr.value)) continue;
      else if (n === 'align' && /^(right|left|center|justify)$/i.test(attr.value)) continue;
      // ووسمُ FONT: يبقى لونُه وحدَه، ويسقط مقاسُه ووجهُه (ملاحظة ٤٩٩)
      else if (child.tagName === 'FONT' && n === 'color' && SAFE_VALUE.test(attr.value) && !PAPER.test(attr.value.trim())) continue;
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
