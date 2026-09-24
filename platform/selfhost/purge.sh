#!/bin/sh
# محو نهائي لما مضى على حذفه أكثر من المهلة (أسبوع افتراضًا) — ملاحظة ٧٤
#   الملفات تُحذف عبر واجهة التخزين، ثم تُمحى صفوف قاعدة البيانات.
# الجدولة:  sudo sh purge.sh --install-cron
# تجربة يدوية:  sudo sh purge.sh
set -e
PROJECT="${PROJECT:-/opt/haramain/supabase}"
DAYS="${DAYS:-7}"
API="${API:-https://api.haramainsermons.com}"

if [ "$1" = "--install-cron" ]; then
    SELF="$(cd "$(dirname "$0")" && pwd)/purge.sh"
    # 03:10 بتوقيت الرياض = 00:10 UTC — بعد النسخة الاحتياطية بساعة
    echo "PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" > /etc/cron.d/haramain-purge
    echo "10 0 * * * root PROJECT=$PROJECT DAYS=$DAYS API=$API sh $SELF >> /var/log/haramain-purge.log 2>&1" >> /etc/cron.d/haramain-purge
    chmod 644 /etc/cron.d/haramain-purge
    echo "scheduled daily 03:10 Riyadh. log: /var/log/haramain-purge.log"
    exit 0
fi

PGPASS=$(grep '^POSTGRES_PASSWORD=' "$PROJECT/.env" | cut -d= -f2-)
SRV=$(grep '^SERVICE_ROLE_KEY=' "$PROJECT/.env" | cut -d= -f2-)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

psql_db() { docker exec -i -e PGPASSWORD="$PGPASS" supabase-db \
    psql -h 127.0.0.1 -U supabase_admin -d postgres -tA "$@"; }

# ١) حذف الملفات عبر واجهة التخزين (الحذف المباشر من جداولها ممنوع)
FILES=0
PATHS=$(psql_db -F '|' -c "select bucket, path from public.deleted_archive_paths($DAYS)")
if [ -n "$PATHS" ]; then
    echo "$PATHS" | while IFS='|' read -r BUCKET OBJ; do
        [ -n "$OBJ" ] || continue
        curl -s -o /dev/null -X DELETE \
             -H "Authorization: Bearer $SRV" -H "apikey: $SRV" \
             "$API/storage/v1/object/$BUCKET/$OBJ" || true
    done
    FILES=$(echo "$PATHS" | grep -c . || true)
fi

# ٢) محو الصفوف
OUT=$(psql_db -c "select * from public.purge_deleted_archive($DAYS)")
echo "[$STAMP] purged (materials|tracks): $OUT | files: $FILES"
