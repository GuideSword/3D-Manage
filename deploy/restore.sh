#!/bin/sh
set -eu
backup=''; deployment=''; project=''; confirmed=''; prebackup=''; allow_empty=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup-dir) backup=$2; shift 2;; --deployment-dir) deployment=$2; shift 2;;
    --project-name) project=$2; shift 2;; --confirmed-server-id) confirmed=$2; shift 2;;
    --pre-restore-backup) prebackup=$2; shift 2;; --allow-empty-target) allow_empty=true; shift;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
[ -n "$backup" ] && [ -n "$deployment" ] && [ -n "$project" ] && [ -n "$confirmed" ] || { echo 'Missing required arguments' >&2; exit 2; }
backup=$(cd "$backup" && pwd -P); deployment=$(cd "$deployment" && pwd -P)
node - "$backup" "$confirmed" <<'NODE'
const fs=require('fs'),crypto=require('crypto'),path=require('path'); const [dir,id]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))); if(m.status!=='complete'||m.serverId!==id||m.storeSchemaVersion>2||m.postgresMajor!==16) throw Error('Incompatible or unconfirmed backup');
for(const [file,key] of [['database.dump','databaseDumpSha256'],['files.tar.gz','filesArchiveSha256']]) { const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'); if(hash!==m.hashes[key]) throw Error(file+' hash mismatch'); }
NODE
key_value=$(awk -F= '/^AGENT_KEY_ENC_SECRET=/{sub(/^[^=]*=/,""); print; exit}' "$deployment/.env"); [ -n "$key_value" ] || { echo 'Recovery encryption key missing' >&2; exit 6; }
key_id=$(printf %s "$key_value" | sha256sum | cut -c1-16)
manifest_key=$(node -e "console.log(require(process.argv[1]).encryptionKeyId)" "$backup/manifest.json"); [ "$key_id" = "$manifest_key" ] || { echo 'Recovery encryption key mismatch' >&2; exit 6; }
docker run --rm -v "$backup:/backup:ro" alpine:3.22 tar -tzf /backup/files.tar.gz | while IFS= read -r entry; do case "$entry" in /*|../*|*/../*|*/..) echo "Unsafe archive entry: $entry" >&2; exit 4;; data|data/*|uploads|uploads/*) :;; *) echo "Unexpected archive entry: $entry" >&2; exit 4;; esac; done
docker run --rm -v "$backup:/backup:ro" alpine:3.22 tar -tvzf /backup/files.tar.gz | awk 'substr($0,1,1)=="l" || substr($0,1,1)=="h" { exit 1 }'
lock="$deployment/.manage3d-operation.lock"; (set -C; : > "$lock") 2>/dev/null || { echo 'Another operation is active' >&2; exit 3; }; trap 'rm -f "$lock"' EXIT INT TERM
cd "$deployment"; db=$(docker compose -p "$project" ps -q db); [ -n "$db" ]
current=$(docker compose -p "$project" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT data->''system''->>''serverId'' FROM app_store WHERE id=''default''" 2>/dev/null || true')
if [ -n "$current" ] && [ "$allow_empty" = false ]; then [ -n "$prebackup" ] && [ -d "$prebackup" ] || { echo 'Populated target requires pre-restore backup' >&2; exit 5; }; [ "$current" = "$confirmed" ] || exit 5; elif [ -z "$current" ] && [ "$allow_empty" = false ]; then echo 'Use --allow-empty-target' >&2; exit 5; fi
docker cp "$backup/database.dump" "$db:/tmp/manage3d-restore.dump"
docker compose -p "$project" exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists manage3d_restore_check; createdb -U "$POSTGRES_USER" manage3d_restore_check; pg_restore -U "$POSTGRES_USER" -d manage3d_restore_check /tmp/manage3d-restore.dump'
check=$(docker compose -p "$project" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d manage3d_restore_check -Atc "SELECT data->''system''->>''serverId'' FROM app_store WHERE id=''default''"'); [ "$check" = "$confirmed" ]
check_counts=$(docker compose -p "$project" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d manage3d_restore_check -Atc "SELECT jsonb_build_object(''users'',jsonb_array_length(data->''users''),''orders'',jsonb_array_length(data->''orders''),''models'',jsonb_array_length(data->''models''),''materials'',jsonb_array_length(data->''materials''),''stockLots'',jsonb_array_length(data->''stockLots''),''inventoryTxns'',jsonb_array_length(data->''inventoryTxns''),''auditLogs'',jsonb_array_length(data->''auditLogs'')) FROM app_store WHERE id=''default''"')
node -e 'const fs=require("fs"); const expected=JSON.parse(fs.readFileSync(process.argv[1])).collectionCounts; const actual=JSON.parse(process.argv[2]); for(const key of Object.keys(expected)) if(expected[key]!==actual[key]) throw Error("count mismatch: "+key)' "$backup/manifest.json" "$check_counts"
docker compose -p "$project" stop -t 30 app
stamp=$(date -u +%s); stage="$deployment/runtime.restore-stage.$stamp"; prior="$deployment/runtime.pre-restore.$stamp"; mkdir "$stage" "$prior"
docker run --rm -v "$backup:/backup:ro" -v "$stage:/stage" alpine:3.22 tar -xzf /backup/files.tar.gz -C /stage --no-same-owner
docker compose -p "$project" run --rm --no-deps -v "$stage/data:/app/data" app node scripts/verify-agent-db.js
for name in data uploads; do [ ! -d "$deployment/runtime/$name" ] || mv "$deployment/runtime/$name" "$prior/$name"; mv "$stage/$name" "$deployment/runtime/$name"; done; rmdir "$stage"
docker compose -p "$project" exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB"; createdb -U "$POSTGRES_USER" "$POSTGRES_DB"; pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/manage3d-restore.dump'
docker compose -p "$project" up -d app
echo "Restore complete; prior runtime retained at $prior. Rotate JWT_SECRET to invalidate all copied tokens."
