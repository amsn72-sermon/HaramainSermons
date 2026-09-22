#!/bin/sh
# تطبيق تحديثات قاعدة البيانات التي لم تُطبَّق بعد، بالترتيب.
#   cd ~/HaramainSermons && git pull && sudo sh platform/selfhost/migrate.sh
# يحفظ ما طُبّق في جدول public.schema_migrations، فلا يُطبَّق ملف مرتين.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HERE/../supabase/migrations"
PROJECT="${PROJECT:-/opt/haramain/supabase}"
[ "$(id -u)" = "0" ] || { echo "شغّل السكربت بـ sudo" >&2; exit 1; }
PGPASS=$(grep '^POSTGRES_PASSWORD=' "$PROJECT/.env" | cut -d= -f2-)
psql_db() { docker exec -i -e PGPASSWORD="$PGPASS" supabase-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

psql_db -q -c "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())"
psql_db -q -c "alter table public.schema_migrations enable row level security"
# التثبيت الأول طبّق 0001 قبل وجود هذا الجدول
psql_db -q -c "insert into public.schema_migrations (name) select '0001_init.sql' where to_regclass('public.tracks') is not null on conflict do nothing"

for f in "$DIR"/*.sql; do
    name=$(basename "$f")
    if psql_db -tAc "select 1 from public.schema_migrations where name = '$name'" | grep -q 1; then
        echo "✓ $name (مطبّق)"
        continue
    fi
    echo "→ تطبيق $name"
    { echo "begin;"; cat "$f"; echo "insert into public.schema_migrations (name) values ('$name');"; echo "commit;"; } | psql_db -q
    echo "✓ $name"
done
echo "قاعدة البيانات محدّثة."
