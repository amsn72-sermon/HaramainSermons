#!/bin/sh
# تثبيت Supabase ذاتي الاستضافة لمنصة ترجمة خطب الحرمين على خادم Ubuntu.
#
# يستخدم سكربت Supabase الرسمي (docker/setup.sh) ثم يضيف:
#   - HTTPS تلقائي عبر Caddy على دومين الـAPI
#   - إغلاق Studio ومنفذ قاعدة البيانات عن الإنترنت
#   - إعدادات البريد والتحويل لموقع المنصة
#   - تطبيق مخطط المنصة 0001_init.sql
#
# الاستخدام (من داخل مجلد platform/selfhost على الخادم):
#   sudo sh install.sh
#
# متغيرات يمكن تمريرها بدل الأسئلة:
#   API_DOMAIN=api.haramainsermons.com SITE_URL=https://haramainsermons.com sudo -E sh install.sh

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$HERE/../supabase/migrations/0001_init.sql"  # للتحقق من تشغيل السكربت من المستودع
BASE="${BASE:-/opt/haramain}"
PROJECT="$BASE/supabase"
SETUP_URL="https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh"

log()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mخطأ: %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { printf '%s [%s]: ' "$1" "$2" > /dev/tty; read -r v < /dev/tty; echo "${v:-$2}"; }
set_env() { # set_env KEY VALUE  — يستبدل السطر أو يضيفه
    esc=$(printf '%s' "$2" | sed -e 's/[|&\\]/\\&/g')
    if grep -q "^$1=" .env; then sed -i "s|^$1=.*$|$1=$esc|" .env; else echo "$1=$2" >> .env; fi
}

[ "$(id -u)" = "0" ] || die "شغّل السكربت بـ sudo"
[ -f "$MIGRATION" ] || die "لم أجد $MIGRATION — شغّل السكربت من داخل المستودع"

API_DOMAIN="${API_DOMAIN:-$(ask 'دومين الـAPI' 'api.haramainsermons.com')}"
SITE_URL="${SITE_URL:-$(ask 'رابط موقع المنصة' 'https://haramainsermons.com')}"

# --- ١. التحقق من أن الدومين يشير إلى هذا الخادم (يلزم لإصدار شهادة HTTPS)
MY_IP=$(curl -fsS https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$API_DOMAIN" | awk 'NR==1{print $1}')
if [ -n "$MY_IP" ] && [ "$MY_IP" != "$DNS_IP" ]; then
    printf '\nتنبيه: %s يشير إلى "%s" وعنوان هذا الخادم %s.\n' "$API_DOMAIN" "$DNS_IP" "$MY_IP"
    printf 'في Cloudflare يجب أن يكون السجل A لـ api بعنوان الخادم و Proxy status = DNS only (سحابة رمادية).\n'
    [ "$(ask 'المتابعة رغم ذلك؟ (y/n)' 'n')" = "y" ] || exit 1
fi

# --- ٢. سكربت Supabase الرسمي: Docker + الملفات + توليد الأسرار والمفاتيح
mkdir -p "$BASE"
cd "$BASE"
if [ ! -f "$PROJECT/.env" ]; then
    log "تنزيل وتشغيل سكربت الإعداد الرسمي من Supabase"
    curl -fsSL "$SETUP_URL" -o setup.sh
    sh setup.sh -y --with-aws --project-dir supabase
else
    log "المشروع موجود في $PROJECT — لن يُعاد توليد الأسرار"
fi
cd "$PROJECT"

# --- ٣. إعدادات المنصة
log "ضبط الروابط والبريد"
set_env SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
set_env API_EXTERNAL_URL "https://$API_DOMAIN/auth/v1"
set_env PROXY_DOMAIN "$API_DOMAIN"
set_env SITE_URL "$SITE_URL"
set_env ADDITIONAL_REDIRECT_URLS "$SITE_URL/**"
set_env ENABLE_EMAIL_SIGNUP true
set_env ENABLE_EMAIL_AUTOCONFIRM false
set_env ENABLE_ANONYMOUS_USERS false
set_env ENABLE_PHONE_SIGNUP false
set_env STUDIO_DEFAULT_ORGANIZATION "الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي"
set_env STUDIO_DEFAULT_PROJECT "منصة ترجمة خطب الحرمين"

if grep -q '^SMTP_HOST=supabase-mail' .env; then
    printf '\nإعدادات البريد الرسمي (تأكيد الحساب واستعادة كلمة المرور).\n'
    printf 'اتركها فارغة الآن إن لم تكن جاهزة، وعدّلها لاحقًا في %s/.env ثم: sh run.sh recreate auth\n' "$PROJECT"
    SMTP_HOST=$(ask 'SMTP host' '')
    if [ -n "$SMTP_HOST" ]; then
        set_env SMTP_HOST "$SMTP_HOST"
        set_env SMTP_PORT "$(ask 'SMTP port' '587')"
        set_env SMTP_USER "$(ask 'SMTP user' '')"
        printf 'SMTP password: ' > /dev/tty; stty -echo < /dev/tty; read -r p < /dev/tty; stty echo < /dev/tty; echo
        set_env SMTP_PASS "$p"
        set_env SMTP_ADMIN_EMAIL "$(ask 'عنوان المرسل' "no-reply@${SITE_URL#https://}")"
        set_env SMTP_SENDER_NAME "$(ask 'اسم المرسل' 'منصة ترجمة خطب الحرمين')"
    fi
fi

# --- ٤. Caddy + طبقة الحماية الخاصة بنا
log "تفعيل HTTPS وإغلاق Studio وقاعدة البيانات عن الإنترنت"
[ -f volumes/proxy/caddy/Caddyfile.orig ] || cp volumes/proxy/caddy/Caddyfile volumes/proxy/caddy/Caddyfile.orig
cp "$HERE/Caddyfile" volumes/proxy/caddy/Caddyfile
cp "$HERE/docker-compose.haramain.yml" docker-compose.haramain.yml
sh run.sh config add caddy haramain
chmod 600 .env

# --- ٥. جدار الحماية: الخادم يفتح 22 فقط افتراضيًا؛ نضيف 80 و443
# صور Ubuntu في Oracle تأتي بقواعد iptables تمنع 80/443
if iptables -S INPUT 2>/dev/null | grep -q 'REJECT'; then
    iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp -m state --state NEW --dport 80 -j ACCEPT
    iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp -m state --state NEW --dport 443 -j ACCEPT
    command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null || true
fi

# --- ٦. التشغيل
log "تشغيل الخدمات (قد يستغرق عدة دقائق أول مرة)"
sh run.sh start

# --- ٧. مخطط المنصة وتحديثاته (كل ملفات supabase/migrations بالترتيب)
log "تطبيق مخطط المنصة"
PROJECT="$PROJECT" sh "$HERE/migrate.sh"

# --- ٨. النتيجة
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
log "اكتمل التثبيت"
cat <<EOF

ضع هاتين القيمتين في platform/app/config.js (قيم علنية مخصصة للمتصفح):

  supabaseUrl:     'https://$API_DOMAIN',
  supabaseAnonKey: '$ANON',

فحص سريع:  curl -s https://$API_DOMAIN/auth/v1/health -H "apikey: \$ANON"

Studio (لوحة الإدارة) من جهازك:
  ssh -L 3001:127.0.0.1:3001 ubuntu@<عنوان الخادم>
  ثم افتح http://localhost:3001  — المستخدم: supabase، وكلمة المرور DASHBOARD_PASSWORD من: sudo sh $PROJECT/run.sh secrets

الأسرار كلها في $PROJECT/.env — لا تنسخها إلى المستودع ولا ترسلها لأحد.
التالي: النسخ الاحتياطي إلى جدة — انظر backup.sh في README.
EOF
