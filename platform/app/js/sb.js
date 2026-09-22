// عميل Supabase مصغّر: المصادقة، واجهة REST، الدوال، والتخزين — بلا مكتبات خارجية.
const cfg = window.HS_CONFIG || {};
const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
const KEY = cfg.supabaseAnonKey || '';
const STORE = 'hs.auth';

// https إلزامي، ويُستثنى الخادم المحلي أثناء التطوير
export const configured = (/^https:\/\//.test(BASE) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE))
  && !BASE.includes('YOUR-PROJECT') && !!KEY && !KEY.includes('YOUR-');

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

let session = readSession();
const listeners = new Set();
let refreshing = null;

function readSession() {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
}
function writeSession(s) {
  session = s;
  try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch { /* تخزين المتصفح غير متاح */ }
  listeners.forEach(fn => { try { fn(session); } catch (e) { console.error(e); } });
}
function fromTokenResponse(d) {
  return { access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user };
}

function authHeader() { return `Bearer ${session?.access_token || KEY}`; }

async function parse(res) {
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const msg = (data && (data.message || data.msg || data.error_description || data.error)) || res.statusText;
    throw new ApiError(translateError(String(msg)), res.status, data && data.code);
  }
  return data;
}

// رسائل أخطاء المصادقة الشائعة بالعربية
function translateError(msg) {
  const map = [
    [/invalid login credentials/i, 'البريد أو كلمة المرور غير صحيحة'],
    [/email not confirmed/i, 'لم يُؤكَّد البريد بعد. افتح رابط التأكيد المرسل إليك'],
    [/user already registered/i, 'هذا البريد مسجل مسبقًا'],
    [/password should be at least/i, 'كلمة المرور قصيرة (٨ أحرف على الأقل)'],
    [/rate limit/i, 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة'],
    [/jwt expired/i, 'انتهت الجلسة. سجّل الدخول من جديد'],
    [/Database error saving new user/i, 'تعذّر حفظ بيانات التسجيل. تحقق من رقم الهوية (١٠ أرقام تبدأ بـ١ أو ٢)'],
    [/permission denied|row-level security/i, 'لا تملك صلاحية هذا الإجراء'],
    [/Failed to fetch|NetworkError/i, 'تعذّر الاتصال بالخادم. تحقق من الإنترنت']
  ];
  for (const [re, ar] of map) if (re.test(msg)) return ar;
  return msg;
}

async function refresh() {
  if (!session?.refresh_token) return;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(parse).then(d => writeSession(fromTokenResponse(d)))
      .catch(() => writeSession(null))
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function ensureFresh() {
  if (session && session.expires_at * 1000 - Date.now() < 60_000) await refresh();
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}, retried = false) {
  await ensureFresh();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { apikey: KEY, Authorization: authHeader(), ...(raw ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
  } catch (e) { throw new ApiError(translateError(e.message), 0); }
  if (res.status === 401 && session && !retried) { await refresh(); return request(path, { method, body, headers, raw }, true); }
  return parse(res);
}

// ---------------------------------------------------------------------
export const auth = {
  get session() { return session; },
  get user() { return session?.user || null; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async signIn(email, password) {
    const d = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    writeSession(fromTokenResponse(d));
    return d.user;
  },
  async signUp(email, password, data) {
    const redirect = encodeURIComponent(location.origin + '/login');
    return request(`/auth/v1/signup?redirect_to=${redirect}`, { method: 'POST', body: { email, password, data } });
  },
  async signOut() {
    try { if (session) await request('/auth/v1/logout', { method: 'POST' }); } catch { /* الجلسة منتهية أصلًا */ }
    writeSession(null);
  },
  async recover(email) {
    const redirect = encodeURIComponent(location.origin + '/reset');
    return request(`/auth/v1/recover?redirect_to=${redirect}`, { method: 'POST', body: { email } });
  },
  async updatePassword(password) {
    return request('/auth/v1/user', { method: 'PUT', body: { password } });
  },
  // روابط البريد (التأكيد، استعادة كلمة المرور) تعيد الرموز في جزء العنوان بعد #
  consumeUrlTokens() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('error_description')) return { error: h.get('error_description').replace(/\+/g, ' ') };
    if (!h.get('access_token')) return null;
    writeSession({
      access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
      expires_at: Number(h.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(h.get('expires_in') || 3600), user: null
    });
    history.replaceState(null, '', location.pathname + location.search);
    return { type: h.get('type') };
  },
  async loadUser() {
    if (!session) return null;
    const u = await request('/auth/v1/user');
    writeSession({ ...session, user: u });
    return u;
  }
};

// ---------------------------------------------------------------------
function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export const db = {
  select(table, params = {}) { return request(`/rest/v1/${table}?${qs(params)}`); },
  rpc(fn, args = {}) { return request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args }); },
  update(table, match, values) {
    return request(`/rest/v1/${table}?${qs(match)}`, { method: 'PATCH', body: values, headers: { Prefer: 'return=representation' } });
  },
  insert(table, values) {
    return request(`/rest/v1/${table}`, { method: 'POST', body: values, headers: { Prefer: 'return=representation' } });
  },
  remove(table, match) { return request(`/rest/v1/${table}?${qs(match)}`, { method: 'DELETE' }); }
};

export const storage = {
  async upload(bucket, path, file) {
    const safe = path.split('/').map(encodeURIComponent).join('/');
    await request(`/storage/v1/object/${bucket}/${safe}`, {
      method: 'POST', raw: true, body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': '3600' }
    });
    return path;
  },
  publicUrl(bucket, path) {
    return `${BASE}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  },
  async signedUrl(bucket, path, expiresIn = 3600) {
    const safe = path.split('/').map(encodeURIComponent).join('/');
    const d = await request(`/storage/v1/object/sign/${bucket}/${safe}`, { method: 'POST', body: { expiresIn } });
    return `${BASE}/storage/v1${d.signedURL || d.signedUrl}`;
  }
};
