# QQBot NapCat WebUI Gateway Design

## Background

QQBot already manages NapCat containers, WebUI tokens, login sessions, runtime
profile evidence, and split account status inside the API. Admin can observe and
drive the curated login flow, but it cannot open the original NapCat WebUI for a
specific account without manually exposing container ports and tokens.

The new requirement is to open the original NapCat WebUI from Admin for one
QQBot account, with full WebUI operation capability, while keeping NapCat
container addresses, WebUI tokens, credentials, and host topology server-side.

## Goals

- Add a QQBot account-row operation that opens the selected account's NapCat
  WebUI in a second-level Admin route page.
- Implement NapCat WebUI access through an independent
  `kt-napcat-webui-gateway` service, not through direct browser access to
  NapCat container ports.
- Bind gateway access sessions to the Admin route page lifecycle.
- Allow full NapCat WebUI operations inside the embedded page.
- Keep NapCat WebUI tokens, NapCat credentials, container IPs, host ports, and
  NAS topology out of browser-visible payloads.
- Record auditable evidence for session creation, activation, heartbeat,
  revocation, expiration, and proxy failures.

## Non-goals

- Do not reimplement the NapCat WebUI as native Admin components.
- Do not make the first version read-only.
- Do not expose NapCat container ports to the public network.
- Do not let the browser call arbitrary upstream URLs through the gateway.
- Do not merge this gateway into the existing login SSE state machine.

## User Experience

Admin adds a new WebUI action on the QQBot account list connection/action area.
Clicking it navigates to:

```text
/qqbot/account/:accountId/napcat-webui
```

The route page is a remote console, not a drawer. It has:

- a compact Admin-owned header with back navigation, account identity, container
  status, session status, refresh session, and close session actions;
- one full-height iframe that loads the gateway URL;
- a failure state for unauthorized, missing container, WebUI offline, session
  expired, or gateway unavailable;
- no page-level body scrolling beyond the existing Vben layout content area.

The route page owns the gateway session. Opening the same WebUI from the account
list always creates a new route-bound session. Page refresh creates a new
session and lets the previous session expire or be revoked by heartbeat timeout.

## High-level Architecture

```text
Admin account list
  -> Admin route /qqbot/account/:accountId/napcat-webui
  -> API: create route-bound gateway session
  -> Gateway: store active session and NapCat target metadata
  -> Admin iframe: gateway bootstrap URL
  -> Gateway: proxy NapCat WebUI HTML, assets, APIs, and WebSocket traffic
  -> NapCat WebUI container
```

The API remains the authority for Admin authentication and QQBot account
binding. The Gateway remains the authority for active WebUI proxy sessions and
NapCat WebUI credential exchange.

## Service Boundaries

### API service

The API service owns Admin-facing authorization and account resolution:

- verify the Admin JWT and QQBot account permissions;
- resolve account, selfId, primary NapCat binding, container id/name, WebUI
  base URL, and WebUI token from existing persistence;
- reject missing, offline, or non-owned NapCat targets before a gateway session
  is created;
- call the Gateway internal API with a service-to-service secret;
- return only an opaque `sessionId`, `iframeUrl`, and safe display metadata to
  Admin;
- proxy heartbeat/revoke calls from Admin to the Gateway internal API;
- write or forward audit events.

The API must not return `webuiToken`, NapCat credential, upstream host, upstream
port, Docker container IP, or NAS SSH details.

### Gateway service

`kt-napcat-webui-gateway` is deployed as a separate process, image, and K8s
Deployment. It owns:

- active session storage and TTL enforcement;
- one-time iframe bootstrap tickets;
- NapCat WebUI credential login using the existing `sha256(token + ".napcat")`
  contract;
- proxying HTTP methods, static assets, WebUI API calls, redirects, cookies, and
  WebSocket upgrade traffic;
- session heartbeat, revocation, expiration, and cleanup;
- gateway-side audit events and structured logs.

The Gateway only proxies to the target already stored in the session. It never
accepts a browser-supplied upstream URL.

### Admin frontend

Admin owns the route UI and lifecycle:

- navigate from account list action to the second-level route page;
- create a session when the page mounts;
- load the returned iframe URL only after session creation succeeds;
- send heartbeat while the route is mounted;
- revoke the session on route leave, explicit close, component unmount, and
  best-effort browser unload;
- render expired/revoked/error states without blank iframes.

## Gateway Session Lifecycle

Sessions are route-bound leases:

```text
created -> active -> revoked
created -> expired
active -> expired
created/active -> failed
```

Creation flow:

1. Admin route mounts and calls `POST /qqbot/napcat/webui/session`.
2. API authorizes the current Admin user and resolves the selected account's
   active NapCat target.
3. API calls Gateway internal `POST /internal/sessions` with safe account
   metadata plus encrypted or service-internal target credentials.
4. Gateway creates an active-session record with TTL and a one-time bootstrap
   ticket.
5. API returns the public iframe bootstrap URL.
6. The iframe loads the bootstrap URL. Gateway redeems the one-time ticket,
   sets an HttpOnly path-scoped gateway cookie, and redirects to the session
   WebUI root.
7. Gateway marks the session active after the first successful proxied WebUI
   response.

Heartbeat and cleanup:

- Admin sends heartbeat every 15 to 30 seconds while the route is mounted.
- Gateway updates `lastSeenAt`.
- If no heartbeat arrives for 60 to 90 seconds, Gateway expires the session.
- Route leave, explicit close, and component unmount call revoke.
- `beforeunload` uses a best-effort sendBeacon revoke, but correctness relies on
  TTL timeout because browser unload is not guaranteed.

Concurrent access policy:

- One active WebUI session is allowed per Admin user plus account.
- Creating a new session for the same Admin user and account revokes the older
  session.
- Other Admin users require their own authorization and separate sessions.

Expired or revoked sessions return HTTP 410 for iframe/proxy requests and a
small gateway error page that tells the Admin page to reopen the route session.

## Public and Internal Contracts

### API Admin contracts

```text
POST /qqbot/napcat/webui/session
Body: { accountId: string }
Result: {
  sessionId: string;
  iframeUrl: string;
  expiresAt: number;
  account: { id: string; selfId: string; nickname?: string };
  container: { id: string; name: string; webuiStatus: string };
}

POST /qqbot/napcat/webui/session/:sessionId/heartbeat
Result: { sessionId: string; expiresAt: number; status: "active" }

POST /qqbot/napcat/webui/session/:sessionId/revoke
Result: true
```

The Admin API responses contain only display-safe metadata.

### Gateway public contracts

```text
GET /napcat-webui/session/:sessionId/bootstrap?ticket=...
GET /napcat-webui/session/:sessionId/webui/*
POST /napcat-webui/session/:sessionId/webui/*
WS  /napcat-webui/session/:sessionId/webui/*
```

The bootstrap ticket is short-lived and one-time. After redemption, the browser
uses only a path-scoped gateway session cookie. The iframe URL should not keep a
long-lived bearer token in the address bar.

### Gateway internal contracts

```text
POST /internal/sessions
POST /internal/sessions/:sessionId/heartbeat
POST /internal/sessions/:sessionId/revoke
GET  /internal/health
```

Internal endpoints require a service-to-service secret or mTLS-equivalent
cluster boundary. They are not exposed through the public Caddy/Admin route.

## Proxy Behavior

The Gateway must support:

- all HTTP methods used by the NapCat WebUI;
- JSON and binary payloads;
- static assets;
- redirects with `Location` rewritten back under the gateway session prefix;
- cookies rewritten to a session-scoped path and never exposed across accounts;
- WebSocket upgrade traffic if NapCat WebUI uses it;
- `Cache-Control: no-store` for sensitive proxied responses;
- removal or replacement of upstream frame headers that would block Admin's
  iframe, while preserving safe CSP around the gateway route.

If NapCat WebUI emits absolute `/api` or `/webui` paths, Gateway rewrites the
HTML and response headers so browser requests remain under:

```text
/napcat-webui/session/:sessionId/webui/
```

The proxy must reject path traversal, encoded upstream URL injection, and any
request that escapes the bound session prefix.

## Security Model

Full NapCat WebUI operations are allowed. Authorization is therefore explicit:
an Admin user who can open the route for an account can fully operate that
account's NapCat WebUI.

Security controls:

- Admin JWT is checked by API before session creation.
- Gateway session is opaque, short-lived, and bound to Admin user id, account id,
  selfId, container id, client metadata, and route lease.
- NapCat WebUI token and credential never leave server-side services.
- Browser-visible URLs contain at most a one-time bootstrap ticket.
- Gateway cookies are HttpOnly, Secure, SameSite, and path-scoped to the
  session.
- Public gateway requests cannot select upstream hosts or ports.
- Internal API-to-Gateway calls are authenticated.
- Audit records include user id, account id, selfId, container id, session id,
  event type, client IP, user agent, timestamps, and safe error summaries.

## Data Model

Active runtime session state lives in Redis so Gateway replicas can share it:

```text
napcat:webui:session:{sessionId}
  status
  adminUserId
  accountId
  selfId
  containerId
  containerName
  upstreamBaseUrl
  encryptedWebuiToken or encrypted credential material
  createdAt
  activeAt
  lastSeenAt
  expiresAt
  revokedAt
```

Gateway audit history is persisted in MySQL, either through the API service or a
Gateway-owned table managed from the API repository:

```text
qqbot_napcat_webui_gateway_audit
  id
  session_id
  admin_user_id
  account_id
  self_id
  container_id
  event_type
  client_ip
  user_agent
  detail_json
  create_time
```

No WebUI token, NapCat credential, QQ password, captcha ticket, QR payload, or
raw proxied response is stored in audit rows.

## Deployment

The first implementation keeps the service source in the API repository but
builds and deploys it as a separate service:

- independent app entry for `kt-napcat-webui-gateway`;
- independent Dockerfile or Docker target;
- Jenkins build and push for the Gateway image;
- K8s Deployment and Service;
- Caddy/Admin domain route such as:

```text
https://admin.kwitsukasa.top/napcat-webui/*
```

The route points to the Gateway service, while the existing API remains under
`/api/*`. Local development should provide an equivalent Vite or Caddy proxy so
Admin can test the iframe route without exposing NapCat container ports.

## Error Handling

- Missing account or no active NapCat binding: Admin route shows a clear empty
  state with a link back to the account list.
- Container offline or WebUI unavailable: session creation fails before iframe
  load and shows the runtime evidence returned by API.
- Gateway cannot authenticate to NapCat WebUI: session fails with a sanitized
  error and an audit event.
- Session expired or revoked: iframe receives HTTP 410 and Admin page offers a
  one-click session reopen.
- Gateway target proxy timeout: render an error overlay and keep route controls
  available.
- API and Gateway clocks must not be used as the only correctness boundary;
  Redis TTL and heartbeat timestamps drive cleanup.

## Testing Strategy

Backend/API:

- unit test account authorization and session creation DTOs;
- unit test no secret fields are returned to Admin;
- integration test API creates and revokes Gateway sessions through a mocked
  internal Gateway client;
- audit tests for create, active, heartbeat, revoke, expire, and proxy failure.

Gateway:

- unit test bootstrap ticket redemption and one-time use;
- unit test session TTL, heartbeat, revoke, and concurrent session revocation;
- proxy tests for path rewriting, cookie scoping, redirect rewriting, and
  forbidden upstream URL injection;
- WebSocket upgrade smoke if NapCat WebUI requires it.

Admin:

- route test for account-row WebUI action navigation;
- lifecycle test for mount create, heartbeat, unmount revoke;
- dark-theme and layout tests for the remote console page;
- Playwright smoke that opens the route, waits for iframe shell load, leaves the
  route, and verifies revoke was called.

Online:

- deploy API and Gateway through Jenkins/K8s;
- verify Gateway health and route availability under the Admin domain;
- open the WebUI page for account `1914728559`;
- confirm the iframe loads the original NapCat WebUI without exposing tokens or
  container ports in the browser URL;
- perform one safe WebUI operation such as reading login status or opening a
  settings page;
- leave the route and verify the session is revoked or expires by heartbeat
  timeout.

## Completion Criteria

- Admin has a working second-level NapCat WebUI route per QQBot account.
- The Gateway is independently deployed and observable.
- Full NapCat WebUI operation works through the iframe route.
- Browser-visible data contains no NapCat token, credential, container IP, host
  port, NAS SSH route, or QQ password.
- Session lifecycle follows the Admin route lifecycle and cleans up on route
  leave or heartbeat timeout.
- API, Gateway, Admin tests and online smoke evidence are recorded before the
  feature is considered complete.
