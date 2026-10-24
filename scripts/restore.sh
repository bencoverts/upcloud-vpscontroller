#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:?Usage: APP_STOPPED=YES RESTORE_CONFIRM=YES ./scripts/restore.sh backups/file.dump}"
[[ "$ARCHIVE" = /* ]] || ARCHIVE="${ROOT_DIR}/${ARCHIVE}"
[[ -s "$ARCHIVE" ]] || { echo "Restore archive not found or empty" >&2; exit 1; }
[[ "${RESTORE_CONFIRM:-}" == "YES" ]] || { echo "Refusing restore: set RESTORE_CONFIRM=YES after reviewing the archive" >&2; exit 1; }
[[ "${APP_STOPPED:-}" == "YES" ]] || { echo "Refusing restore: stop the app and set APP_STOPPED=YES" >&2; exit 1; }

if [[ "${COMPOSE:-0}" == "1" ]]; then
  command -v docker >/dev/null 2>&1 || { echo "docker is required for COMPOSE=1" >&2; exit 1; }
  cd "$ROOT_DIR"
  docker compose exec -T db pg_restore --list < "$ARCHIVE" > /dev/null
  docker compose exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > /dev/null
else
  : "${DATABASE_URL:?Set DATABASE_URL, or use COMPOSE=1 with the Compose db service}"
  command -v pg_restore >/dev/null 2>&1 || { echo "PostgreSQL client tools are required" >&2; exit 1; }
  pg_restore --list "$ARCHIVE" > /dev/null
  pg_isready --dbname="$DATABASE_URL" > /dev/null
fi

printf 'Creating a pre-restore safety backup...\n'
COMPOSE="${COMPOSE:-0}" DATABASE_URL="${DATABASE_URL:-}" "${ROOT_DIR}/scripts/backup.sh"

if [[ "${COMPOSE:-0}" == "1" ]]; then
  docker compose exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error' < "$ARCHIVE"
  docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM servers; SELECT COUNT(*) FROM api_tokens; SELECT COUNT(*) FROM schema_migrations;"' > /dev/null
else
  pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error "$ARCHIVE"
  psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) FROM servers; SELECT COUNT(*) FROM api_tokens; SELECT COUNT(*) FROM schema_migrations;' > /dev/null
fi
printf 'Restore completed and required tables verified. Start the app and run health checks before accepting traffic.\n'
