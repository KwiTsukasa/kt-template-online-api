# QQBot NapCat Schema

NapCat owns container runtime, account binding, device identity, login session,
challenge, cleanup, runtime/profile evidence, login-event, and risk-mode
persistence through the v3 `napcat_*` tables.

- `napcat_container`
- `napcat_device_identity`
- `napcat_account_binding`
- `napcat_login_session`
- `napcat_login_challenge`
- `napcat_runtime_cleanup`
- `napcat_runtime_profile`
- `napcat_protocol_profile`
- `napcat_session_behavior_profile`
- `napcat_login_event`
- `napcat_risk_mode`

Verification SQL:

```sql
SELECT COUNT(*) FROM napcat_container WHERE is_deleted = 0;
SELECT COUNT(*) FROM napcat_device_identity;
SELECT COUNT(*) FROM napcat_account_binding WHERE is_deleted = 0;
SELECT COUNT(*) FROM napcat_runtime_profile;
SELECT COUNT(*) FROM napcat_protocol_profile;
SELECT COUNT(*) FROM napcat_session_behavior_profile;
SELECT COUNT(*) FROM napcat_login_event;
SELECT COUNT(*) FROM napcat_risk_mode;
```
