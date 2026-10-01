# Brightspace Bulk Activity Date Manager

This project focuses on Course Offerings and three native activity types: Assignments, Quizzes and Discussion Topics. The LTI application provides authenticated, read-only discovery. A single-Assignment date writer is now available through an operator CLI. Quiz/Discussion writers, CSV ingestion and bulk execution are not implemented.

The original Brightspace Activity Date Manager folder retains the full 01A/01B baseline. This separate project no longer contains Source Course helpers, Content discovery, hierarchy or relationship resolution. Forums are read only to enumerate Discussion Topics. Secrets were not copied; configure them separately. LTI, OAuth and database identifiers are unchanged by the folder rename.

## Installation and migration

### Shared Atlas cluster, separate database

Use the existing cluster hostname with `/brightspace_activity_date_manager` in the connection URL, before `?` options. Do not use `/lti-db`: that belongs to the other application. The startup guard refuses any other database name or an omitted database name. This app's collections will be created inside the dedicated database on first writes; no existing data is moved or deleted. Preserve your Atlas connection options, including `authSource` if present.

Example: `mongodb+srv://USER:URL_ENCODED_PASSWORD@YOUR_CLUSTER/brightspace_activity_date_manager?retryWrites=true&w=majority`.

For database-level permission isolation as well, create a separate Atlas database user with `readWrite` on `brightspace_activity_date_manager` only, and use that user's credentials here. Sharing a cluster still shares its capacity. The local changes do not modify your Atlas configuration.

1. Install dependencies with `npm install` and start with `npm start`. The included package.json uses ltijs 5.9.9 and Node 22. In Render, set Build Command to `npm install` and Start Command to `npm start`. The service Root Directory must contain package.json and index.js (leave it blank when these files are at the repository root). Commit package.json with the JavaScript source files; never commit render.env or private keys.
2. Generate a persistent signing key once: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out brightspace-private.pem`. Store it in your deployment's secret manager as `D2L_OAUTH2_PRIVATE_KEY` (actual newlines or literal `\n` both work). Do not regenerate on each startup. All instances must use the same key and key ID.
3. Copy `.env.example` to `.env` locally, or configure those variables in Render. Retain your existing BS_* LTI registration values, MongoDB URL, LTI key and supported API versions. The OAuth Client ID is separate from the LTI Client ID.
4. Deploy and make `https://YOUR-APP/.well-known/brightspace-jwks.json` publicly reachable. It exposes only the public key. The API scopes and client ID can initially be placeholders for this discovery step; replace them before testing a launch.
5. In Brightspace create a dedicated Service User with the roles, permissions and org-unit access needed for these API calls. In Admin Tools → Manage Extensibility → OAuth 2.0, register a new app with **Client Credentials**, this JWKS URL, the required space-separated API scopes, and the Service User. Set the desired access-token lifetime within Brightspace's supported range.
6. Set `D2L_OAUTH2_CLIENT_ID` to that new registration's ID and `D2L_OAUTH2_SCOPES` to the required registered scopes. Restart the app and launch from a test course. Configure launch access in the Brightspace LTI installation, then verify normalized activity discovery.
7. After verification, remove `D2L_OAUTH2_CLIENT_SECRET` and `D2L_OAUTH2_REFRESH_TOKEN` from this deployment. The old Mongo OAuth-token document is unused; no database records are deleted by this migration. Revoke the old OAuth grant only when no other integration depends on it.

The application signs a fresh, unique 60-second assertion for each token exchange. It caches access tokens in memory until shortly before expiration and combines simultaneous token requests. No interactive login or refresh token is needed for API authentication. OAuth token errors are sanitized to avoid logging signed assertions.

API access now uses the linked Service User's permissions, regardless of who launches LTI. Brightspace controls who may launch the tool through the LTI installation. The diagnostic requires a validated LTI session from the configured deployment; the app does not maintain a user allowlist or independently filter LTI roles. It takes an explicit OrgUnitId rather than assuming the LTI context ID is a Brightspace numeric course ID.

The JWKS route is separate from ltijs's LTI key endpoint. For planned signing-key rotation, publish both old and new public keys during the transition, switch signing to the new kid, and retire the old key after propagation. This sample publishes one active key, so a coordinated deployment is required if you replace it directly.

## Verification

Run `npm test` and `npm run check`. The fixture and mock tests cover normalizers, discovery, pagination, diagnostics authorization, and existing authentication/deployment/database guards without accessing Brightspace. A live test additionally requires your tenant registration, secrets, MongoDB and an LTI launch.

## Official references

Initial LTI setup: leave BS_CLIENT_ID unset or empty and deploy. The server skips Brightspace platform registration while serving its key endpoints. Use `/keys` for the tool's LTI public keyset, `/login` for its OIDC login URL, and `/` for its target link URL, all under the deployed HTTPS domain. Once Brightspace provides the LTI Client ID, set BS_CLIENT_ID and restart. This only makes BS_CLIENT_ID optional during setup; the other required environment variables, including MongoDB and OAuth signing settings, must still be valid. The OAuth public key endpoint is separately located at `/.well-known/brightspace-jwks.json`.

- [D2L OAuth protocol and JWT requirements](https://docs.valence.desire2learn.com/basic/oauth2.html)
- [D2L server-to-server registration and Service User permissions](https://community.d2l.com/brightspace/kb/articles/33526-register-an-oauth2-0-application-for-server-to-server-authentication)
- [ltijs provider and public-route configuration](https://github.com/Cvmcosta/ltijs/blob/master/docs/provider.md)

## LTI deployment restriction

Set BS_DEPLOYMENT_ID in Render to the exact Deployment ID for this tool in Brightspace (not its Client ID). Restart after changes. The launch and diagnostic handlers check the validated ltijs token.deploymentId before any OAuth or course API request. Missing configuration returns HTTP 503; a missing or different launch Deployment ID returns HTTP 403. During initial setup, leave this variable empty: the server and public key endpoints remain available. Configure it after creating the deployment. Deploy the entire src/ directory along with index.js. The diagnostic requires a validated LTI session; it is not a public or whitelisted route.

## Current discovery

Launch through the configured LMS LTI installation. The diagnostic accepts an OrgUnitId, optional undated activities, JSON output and redacted raw responses. It does not yet verify the OrgUnit type; Course Offering resolution and validation belong to 01D.

`GET /diagnostics/activities?orgUnitId=12345` requires a valid LTI session. Add `includeUndated=1`, `raw=1` or `format=json`. Core discovery includes undated activities by default; the diagnostic checkbox controls display filtering.

The native-only response uses `schemaVersion: 3`, with `orgUnitId`, `complete`, `sources`, `activities`, `counts`, `warnings` and optional `raw`. The previous Content relationship/structure fields are removed.

## Required read scopes

- `dropbox:folders:read`
- `quizzing:quizzes:read`
- `discussions:forums:readonly`
- `discussions:topics:readonly`

Set `D2L_LE_VERSION` to a tenant-supported version >=1.90. LP version, Content scopes and Source Course scopes are no longer required. The discovery app requires no write scopes. The separate Assignment CLI requires `dropbox:folders:write` only when applying changes.

## Organization

```text
index.js                     LTI startup and dependency composition
src/config/database.js       database guard
src/brightspace/              auth, API transport, deployment guard, IDs
  activities/                assignment, quiz and discussion readers; normalizers
src/services/                discovery and normalized activity model
src/routes/                  developer diagnostic
scripts/                     read-only acceptance tools
test/                        tests and JSON fixtures
PLAN.md                      product scope and implementation sequence
TECHNICAL.md                 data contract, safe writes and verification
```

See [PLAN.md](PLAN.md) for scope and implementation sequence, and [TECHNICAL.md](TECHNICAL.md) for the data contract, safe-write requirements and verification.

## 01C — single Assignment dates

`src/brightspace/assignmentWriter.js` reads the native Assignment, validates all three requested dates, preserves settings, updates and verifies. The existing LTI routes remain read-only. This operator command uses the configured Service User directly and is not a public endpoint.

After installing dependencies and configuring `.env`, preview without writing:

```sh
npm run assignment:dates -- 9524 983 '2027-01-01T09:00:00-03:00' '2027-01-02T23:59:00-03:00' '2027-01-03T23:59:00-03:00'
```

Those are example dates, not approved live-test values. Append `--apply` only when the target and dates are intended. Register `dropbox:folders:write` and include it in the operator environment's OAuth scopes for an apply run; retain the necessary read scopes and Service User permissions. No registration, scopes or live data were changed during implementation.

The result is `ready` (dry run), `unchanged`, `updated` (verified), or `failed`, with requested/verified dates and a sanitized error. Unknown availability semantics block an update. See [TECHNICAL.md](TECHNICAL.md) for limits and live acceptance.
