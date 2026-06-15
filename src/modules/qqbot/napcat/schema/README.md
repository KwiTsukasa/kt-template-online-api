# QQBot NapCat Schema

NapCat owns container runtime, account binding, device identity, login session,
challenge, and cleanup persistence.

Current compatibility tables:

- `qqbot_account_napcat`
- `qqbot_napcat_container`
- `napcat_device_identity`

Target v3 tables:

- `napcat_container`
- `napcat_device_identity`
- `napcat_account_binding`
- `napcat_login_session`
- `napcat_login_challenge`
- `napcat_runtime_cleanup`

Verification SQL:

```sql
SELECT COUNT(*) FROM napcat_device_identity;
SELECT COUNT(*) FROM qqbot_account_napcat WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_napcat_container WHERE is_deleted = 0;
```
