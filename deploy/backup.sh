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
cleanup() { code=$?; cd "$deployment"; if [ -n "$running" ]; then docker compose -p "$project" up -d app >/dev/null || code=1; fi; rm -f "$lock"; exit "$code"; }
trap cleanup EXIT INT TERM
cd "$deployment"
running=$(docker compose -p "$project" ps -q app)
[ -z "$running" ] || docker compose -p "$project" stop -t 30 app
docker compose -p "$project" run --rm --no-deps app node scripts/checkpoint-agent-db.js
db=$(docker compose -p "$project" ps -q db); [ -n "$db" ]
docker compose -p "$project" exec -T db sh -c 'rm -f /tmp/manage3d-backup.dump && pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/manage3d-backup.dump'
docker cp "$db:/tmp/manage3d-backup.dump" "$backup/database.dump"
docker compose -p "$project" exec -T db pg_restore -l /tmp/manage3d-backup.dump >/dev/null
docker run --rm -v "$deployment/runtime:/source:ro" -v "$backup:/backup" alpine:3.22 tar -czf /backup/files.tar.gz -C /source data uploads
docker run --rm -v "$backup:/backup:ro" alpine:3.22 tar -tzf /backup/files.tar.gz >/dev/null
server_id=$(docker compose -p "$project" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT data->''system''->>''serverId'' FROM app_store WHERE id=''default''"')
db_hash=$(sha256sum "$backup/database.dump" | awk '{print $1}'); files_hash=$(sha256sum "$backup/files.tar.gz" | awk '{print $1}')
key_value=$(awk -F= '/^AGENT_KEY_ENC_SECRET=/{sub(/^[^=]*=/,""); print; exit}' "$deployment/.env"); [ -n "$key_value" ] || { echo 'AGENT_KEY_ENC_SECRET missing from recovery bundle' >&2; exit 6; }
key_id=$(printf %s "$key_value" | sha256sum | cut -c1-16)
printf '{"status":"complete","serverId":"%s","apiVersion":"1","storeSchemaVersion":2,"utcTimestamp":"%s","postgresMajor":16,"storageMode":"postgres+sqlite+filesystem","encryptionKeyId":"%s","hashes":{"databaseDumpSha256":"%s","filesArchiveSha256":"%s"}}\n' "$server_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$key_id" "$db_hash" "$files_hash" > "$backup/manifest.json"
complete=true
printf '%s\n' "$backup"
