#!/bin/sh
# نسخة احتياطية ليلية: قاعدة البيانات + ملفات التخزين، مشفّرة، إلى Oracle Object Storage في جدة.
#
# الإعداد مرة واحدة (انظر README):
#   1) أنشئ حاوية (Bucket) خاصة في منطقة Jeddah باسم haramain-backups
#   2) أنشئ Customer Secret Key لمستخدم مخصص للنسخ، ثم على الخادم:
#        sudo aws configure --profile jeddah     (Access Key و Secret فقط، المنطقة me-jeddah-1)
#   3) sudo sh -c 'openssl rand -base64 48 > /root/.haramain-backup-key && chmod 600 /root/.haramain-backup-key'
#      واحفظ نسخة من هذا المفتاح خارج الخادم — بدونه لا يمكن فك النسخ.
#   4) sudo OCI_NAMESPACE=<namespace> sh backup.sh     (تجربة يدوية)
#   5) الجدولة:  sudo sh backup.sh --install-cron <namespace>
#
# الاستعادة: restore.sh

set -e
PROJECT="${PROJECT:-/opt/haramain/supabase}"
BUCKET="${BUCKET:-haramain-backups}"
REGION="me-jeddah-1"
KEYFILE="/root/.haramain-backup-key"
KEEP_LOCAL_DAYS=3

if [ "$1" = "--install-cron" ]; then
    [ -n "$2" ] || { echo "الاستخدام: sh backup.sh --install-cron <namespace>" >&2; exit 1; }
    SELF="$(cd "$(dirname "$0")" && pwd)/backup.sh"
    # 02:30 بتوقيت الرياض = 23:30 UTC
    echo "30 23 * * * root OCI_NAMESPACE=$2 PROJECT=$PROJECT sh $SELF >> /var/log/haramain-backup.log 2>&1" > /etc/cron.d/haramain-backup
    chmod 644 /etc/cron.d/haramain-backup
    echo "جُدولت النسخة يوميًا 2:30 فجرًا بتوقيت الرياض. السجل: /var/log/haramain-backup.log"
    exit 0
fi

: "${OCI_NAMESPACE:?حدد OCI_NAMESPACE (Object Storage namespace من إعدادات Tenancy)}"
[ -s "$KEYFILE" ] || { echo "مفتاح التشفير غير موجود: $KEYFILE" >&2; exit 1; }
# توافق AWS CLI الحديث مع واجهة S3 في Oracle
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set s3.addressing_style path --profile jeddah
ENDPOINT="https://${OCI_NAMESPACE}.compat.objectstorage.${REGION}.oraclecloud.com"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$PROJECT/../backups"
mkdir -p "$OUT"; chmod 700 "$OUT"
PGPASS=$(grep '^POSTGRES_PASSWORD=' "$PROJECT/.env" | cut -d= -f2-)

echo "[$STAMP] بدء النسخ"
# قاعدة البيانات كاملة (يشمل auth و storage و public) بصيغة custom
docker exec -e PGPASSWORD="$PGPASS" supabase-db \
    pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$KEYFILE" -out "$OUT/db-$STAMP.dump.enc"

# الملفات المرفوعة (المصادر، الصوت، الوثائق الخاصة)
tar -C "$PROJECT/volumes" -czf - storage \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$KEYFILE" -out "$OUT/storage-$STAMP.tgz.enc"

for f in "$OUT/db-$STAMP.dump.enc" "$OUT/storage-$STAMP.tgz.enc"; do
    aws --profile jeddah --region "$REGION" --endpoint-url "$ENDPOINT" \
        s3 cp "$f" "s3://$BUCKET/$(date -u +%Y/%m)/$(basename "$f")" --only-show-errors
done

find "$OUT" -name '*.enc' -mtime +$KEEP_LOCAL_DAYS -delete
echo "[$STAMP] تم: $(du -ch "$OUT"/*-"$STAMP".* | tail -1 | cut -f1) إلى $BUCKET في جدة"
