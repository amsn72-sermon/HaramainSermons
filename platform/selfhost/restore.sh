#!/bin/sh
# استعادة نسخة احتياطية على خادم جديد بعد تشغيل install.sh عليه.
#   sudo sh restore.sh db-XXXX.dump.enc storage-XXXX.tgz.enc
# تنزيل الملفات من جدة:
#   aws --profile jeddah --region me-jeddah-1 --endpoint-url https://<namespace>.compat.objectstorage.me-jeddah-1.oraclecloud.com \
#       s3 cp s3://haramain-backups/<YYYY>/<MM>/<file> .
set -e
PROJECT="${PROJECT:-/opt/haramain/supabase}"
KEYFILE="/root/.haramain-backup-key"
DB="$1"; FILES="$2"
[ -f "$DB" ] || { echo "الاستخدام: sh restore.sh <db.dump.enc> [storage.tgz.enc]" >&2; exit 1; }
PGPASS=$(grep '^POSTGRES_PASSWORD=' "$PROJECT/.env" | cut -d= -f2-)

printf 'ستُستبدل بيانات المنصة الحالية على هذا الخادم. اكتب "نعم" للمتابعة: '; read -r ok
[ "$ok" = "نعم" ] || exit 1

docker stop supabase-auth supabase-rest supabase-storage >/dev/null
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$KEYFILE" -in "$DB" \
  | docker exec -i -e PGPASSWORD="$PGPASS" supabase-db \
      pg_restore -h 127.0.0.1 -U supabase_admin -d postgres --clean --if-exists \
        --schema=public --schema=auth --schema=storage
docker start supabase-auth supabase-rest supabase-storage >/dev/null
if [ -n "$FILES" ]; then
    cd "$PROJECT" && sh run.sh stop
    openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$KEYFILE" -in "$FILES" | tar -C "$PROJECT/volumes" -xzf -
    sh run.sh start
fi
echo "تمت الاستعادة."
