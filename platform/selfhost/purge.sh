#!/bin/sh
# محو نهائي لما مضى على حذفه أكثر من المهلة (أسبوع افتراضًا) — ملاحظة ٧٤
# الجدولة:  sudo sh purge.sh --install-cron
# تجربة يدوية:  sudo sh purge.sh
set -e
PROJECT="${PROJECT:-/opt/haramain/supabase}"
DAYS="${DAYS:-7}"

if [ "$1" = "--install-cron" ]; then
    SELF="$(cd "$(dirname "$0")" && pwd)/purge.sh"
    # 03:10 بتوقيت الرياض = 00:10 UTC — بعد النسخة الاحتياطية بساعة
    echo "PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" > /etc/cron.d/haramain-purge
    echo "10 0 * * * root PROJECT=$PROJECT DAYS=$DAYS sh $SELF >> /var/log/haramain-purge.log 2>&1" >> /etc/cron.d/haramain-purge
    chmod 644 /etc/cron.d/haramain-purge
    echo "scheduled daily 03:10 Riyadh. log: /var/log/haramain-purge.log"
    exit 0
fi

PGPASS=$(grep '^POSTGRES_PASSWORD=' "$PROJECT/.env" | cut -d= -f2-)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OUT=$(docker exec -e PGPASSWORD="$PGPASS" supabase-db \
        psql -h 127.0.0.1 -U supabase_admin -d postgres -tA \
        -c "select * from public.purge_deleted_archive($DAYS)")
echo "[$STAMP] purged (materials|tracks|objects): $OUT"
