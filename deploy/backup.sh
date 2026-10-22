#!/bin/sh
set -eu
deployment=''; project=''; output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --deployment-dir) deployment=$2; shift 2 ;;
    --project-name) project=$2; shift 2 ;;
    --output-dir) output=$2; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$deployment" ] && [ -n "$project" ] && [ -n "$output" ] || { echo 'Required: --deployment-dir --project-name --output-dir' >&2; exit 2; }
deployment=$(cd "$deployment" && pwd -P)
mkdir -p "$output"; output=$(cd "$output" && pwd -P)
stamp=$(date -u +%Y%m%dT%H%M%SZ); backup="$output/$stamp"; mkdir "$backup"
lock="$deployment/.manage3d-operation.lock"
( set -C; : > "$lock" ) 2>/dev/null || { echo 'Another backup/restore/upgrade operation is active.' >&2; exit 3; }
running=''; complete=false
cleanup() {
  code=$?
  if [ "$complete" != true ]; then
    printf '{"status":"incomplete","exitCode":%s,"utcTimestamp":"%s"}\n' "$code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$backup/manifest.incomplete.json" || code=1
  fi
  cd "$deployment"
  if [ -n "$running" ]; then docker start "$running" >/dev/null || code=1; fi
  rm -f "$lock"
  exit "$code"
}
trap cleanup EXIT INT TERM
cd "$deployment"
running=$(docker compose -p "$project" ps -q app)
app_container=$running; [ -n "$app_container" ] || app_container=$(docker compose -p "$project" ps -aq app)
image_digest=''; [ -z "$app_container" ] || image_digest=$(docker inspect --format '{{.Image}}' "$app_container")
[ -z "$running" ] || docker compose -p "$project" stop -t 30 app
docker compose -p "$project" run --rm --no-deps app node scripts/checkpoint-agent-db.js
db=$(docker compose -p "$project" ps -q db); [ -n "$db" ]
docker compose -p "$project" exec -T db sh -c 'rm -f /tmp/manage3d-backup.dump && pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/manage3d-backup.dump'
docker cp "$db:/tmp/manage3d-backup.dump" "$backup/database.dump"
docker compose -p "$project" exec -T db pg_restore -l /tmp/manage3d-backup.dump >/dev/null
docker run --rm -v "$deployment/runtime:/source:ro" -v "$backup:/backup" alpine:3.22 tar -czf /backup/files.tar.gz -C /source data uploads
docker run --rm -v "$backup:/backup:ro" alpine:3.22 tar -tzf /backup/files.tar.gz >/dev/null
metadata=$(docker compose -p "$project" run --rm --no-deps -v "$deployment/backend/scripts/store-backup-metadata.js:/app/scripts/store-backup-metadata.js:ro" -v "$deployment/backend/config/runtime.js:/app/config/runtime.js:ro" app node scripts/store-backup-metadata.js)
db_hash=$(sha256sum "$backup/database.dump" | awk '{print $1}'); files_hash=$(sha256sum "$backup/files.tar.gz" | awk '{print $1}')
key_value=$(awk -F= '/^AGENT_KEY_ENC_SECRET=/{sub(/^[^=]*=/,""); print; exit}' "$deployment/.env"); [ -n "$key_value" ] || { echo 'AGENT_KEY_ENC_SECRET missing from recovery bundle' >&2; exit 6; }
key_id=$(printf %s "$key_value" | sha256sum | cut -c1-16)
node - "$metadata" "$key_id" "$image_digest" "$db_hash" "$files_hash" "$project" > "$backup/manifest.json" <<'NODE'
const [raw,encryptionKeyId,appImageDigest,databaseDumpSha256,filesArchiveSha256,composeProject]=process.argv.slice(2);
const metadata=JSON.parse(raw);
console.log(JSON.stringify({...metadata,status:'complete',apiVersion:'1',utcTimestamp:new Date().toISOString(),postgresMajor:16,storageMode:'postgres+sqlite+local-files',encryptionKeyId,appImageDigest,composeProject,hashes:{databaseDumpSha256,filesArchiveSha256}},null,2));
NODE
complete=true
printf '%s\n' "$backup"
