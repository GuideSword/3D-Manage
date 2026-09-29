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
[ -z "$prebackup" ] || prebackup=$(cd "$prebackup" && pwd -P)
contract="$deployment/deploy/backup-contract.cjs"
node "$contract" verify "$backup" "$confirmed"
key_value=$(awk -F= '/^AGENT_KEY_ENC_SECRET=/{sub(/^[^=]*=/,""); print; exit}' "$deployment/.env"); [ -n "$key_value" ] || { echo 'Recovery encryption key missing' >&2; exit 6; }
key_id=$(printf %s "$key_value" | sha256sum | cut -c1-16)
manifest_key=$(node -e "console.log(require(process.argv[1]).encryptionKeyId)" "$backup/manifest.json"); [ "$key_id" = "$manifest_key" ] || { echo 'Recovery encryption key mismatch' >&2; exit 6; }
entries=$(docker run --rm -v "$backup:/backup:ro" alpine:3.22 tar -tzf /backup/files.tar.gz)
printf '%s\n' "$entries" | while IFS= read -r entry; do case "$entry" in /*|../*|*/../*|*/..) echo "Unsafe archive entry: $entry" >&2; exit 4;; data|data/*|uploads|uploads/*) :;; *) echo "Unexpected archive entry: $entry" >&2; exit 4;; esac; done
printf '%s\n' "$entries" | awk '/^data\/?$/ {d=1} /^uploads\/?$/ {u=1} END {exit !(d&&u)}'
verbose_entries=$(docker run --rm -v "$backup:/backup:ro" alpine:3.22 tar -tvzf /backup/files.tar.gz)
printf '%s\n' "$verbose_entries" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {exit 1}'
lock="$deployment/.manage3d-operation.lock"; (set -C; : > "$lock") 2>/dev/null || { echo 'Another operation is active' >&2; exit 3; }; trap 'rm -f "$lock"' EXIT INT TERM
cd "$deployment"; db=$(docker compose -p "$project" ps -q db); [ -n "$db" ]
target_metadata=$(docker compose -p "$project" run --rm --no-deps -v "$deployment/backend/scripts/store-backup-metadata.js:/app/scripts/store-backup-metadata.js:ro" -v "$deployment/backend/config/runtime.js:/app/config/runtime.js:ro" app node scripts/store-backup-metadata.js --allow-empty)
current=$(node -e 'console.log(JSON.parse(process.argv[1]).serverId||"")' "$target_metadata")
if [ -n "$current" ]; then
  [ -n "$prebackup" ] && [ -d "$prebackup" ] || { echo 'Populated target requires pre-restore backup' >&2; exit 5; }
  [ "$current" = "$confirmed" ] || { echo 'Target identity mismatch' >&2; exit 5; }
  prebackup=$(cd "$prebackup" && pwd -P)
  [ "$prebackup" != "$backup" ] || { echo 'Pre-restore backup must be separate' >&2; exit 5; }
  node "$contract" verify "$prebackup" "$current"
elif [ "$allow_empty" = false ]; then echo 'Use --allow-empty-target' >&2; exit 5; fi
docker cp "$backup/database.dump" "$db:/tmp/manage3d-restore.dump"
docker compose -p "$project" exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists manage3d_restore_check && createdb -U "$POSTGRES_USER" manage3d_restore_check && pg_restore -U "$POSTGRES_USER" -d manage3d_restore_check /tmp/manage3d-restore.dump'
check_metadata=$(docker compose -p "$project" run --rm --no-deps -v "$deployment/backend/scripts/store-backup-metadata.js:/app/scripts/store-backup-metadata.js:ro" -v "$deployment/backend/config/runtime.js:/app/config/runtime.js:ro" app node scripts/store-backup-metadata.js manage3d_restore_check)
node "$contract" compare "$backup" "$confirmed" "$check_metadata"
docker compose -p "$project" stop -t 30 app
stamp=$(date -u +%s); stage="$deployment/runtime.restore-stage.$stamp"; prior="$deployment/runtime.pre-restore.$stamp"; mkdir "$stage" "$prior"
docker run --rm -v "$backup:/backup:ro" -v "$stage:/stage" alpine:3.22 tar -xzf /backup/files.tar.gz -C /stage --no-same-owner
docker compose -p "$project" run --rm --no-deps -v "$stage/data:/app/data" app node scripts/verify-agent-db.js
for name in data uploads; do [ ! -d "$deployment/runtime/$name" ] || mv "$deployment/runtime/$name" "$prior/$name"; mv "$stage/$name" "$deployment/runtime/$name"; done; rmdir "$stage"
docker compose -p "$project" exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/manage3d-restore.dump'
docker compose -p "$project" up -d app
echo "Restore complete; prior runtime retained at $prior. Rotate JWT_SECRET to invalidate all copied tokens."
