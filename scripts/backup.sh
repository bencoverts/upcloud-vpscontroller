#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/cerdasnet-${STAMP}.dump"
TEMP="${ARCHIVE}.tmp"
mkdir -p "$BACKUP_DIR"
trap 'rm -f "$TEMP"' EXIT

if [[ "${COMPOSE:-0}" == "1" ]]; then
  command -v docker >/dev/null 2>&1 || { echo "docker is required for COMPOSE=1" >&2; exit 1; }
  cd "$ROOT_DIR"
  docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TEMP"
  docker compose exec -T db pg_restore --list < "$TEMP" > /dev/null
else
  : "${DATABASE_URL:?Set DATABASE_URL, or use COMPOSE=1 with the Compose db service}"
  command -v pg_dump >/dev/null 2>&1 || { echo "PostgreSQL client tools are required" >&2; exit 1; }
  pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges > "$TEMP"
  pg_restore --list "$TEMP" > /dev/null
fi

[[ -s "$TEMP" ]] || { echo "Backup is empty" >&2; exit 1; }
mv "$TEMP" "$ARCHIVE"
sha256sum "$ARCHIVE" > "${ARCHIVE}.sha256"
chmod 600 "$ARCHIVE" "${ARCHIVE}.sha256"
printf 'Backup created and catalog verified: %s\n' "$ARCHIVE"
trap - EXIT
