# Refactor V3 Rebuild Runbook

## Local Dry Run

1. Create an empty local database dedicated to refactor V3.
2. Apply `sql/refactor-v3/00-full-schema.sql`.
3. Apply `sql/refactor-v3/01-seed-core.sql`.
4. Run `sql/refactor-v3/99-verify.sql`.
5. Start API against the dry-run database.
6. Run `scripts/refactor-v3/local-smoke.ps1`.

## Online Backup

1. Confirm the exact API image tag and current database name.
2. Run `scripts/refactor-v3/db-backup-online.ps1`.
3. Record backup path, timestamp, source database, and restore command.

## Online Rebuild

1. Stop or limit API write traffic.
2. Apply full schema and seed scripts.
3. Run verify SQL.
4. Deploy API/Admin image versions bound to this schema.
5. Run online smoke bundle.

## Rollback

1. Stop write traffic.
2. Restore the recorded backup or previous schema bundle.
3. Roll back API/Admin images.
4. Re-run smoke for the restored version.
