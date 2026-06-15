# QQBot NapCat Schema

NapCat owns container runtime, account binding, device identity, login session,
challenge, and cleanup persistence through the v3 `napcat_*` tables.

- `napcat_container`
- `napcat_device_identity`
- `napcat_account_binding`
- `napcat_login_session`
- `napcat_login_challenge`
- `napcat_runtime_cleanup`

Verification SQL:

```sql
SELECT COUNT(*) FROM napcat_container WHERE is_deleted = 0;
SELECT COUNT(*) FROM napcat_device_identity;
SELECT COUNT(*) FROM napcat_account_binding WHERE is_deleted = 0;
```
