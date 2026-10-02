# Brightspace Bulk Activity Date Manager

This project focuses on Course Offerings and three native activity types: Assignments, Quizzes and Discussion Topics. The LTI application provides discovery plus an Assignment, Quiz and Discussion Topic preview/apply test form. A single-Assignment operator CLI is also available. Quiz and Discussion Topic writers are implemented locally; live acceptance is pending. CSV ingestion and bulk execution are not implemented.

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

Set `D2L_LE_VERSION` to a tenant-supported version >=1.90. LP version, Content scopes and Source Course scopes are no longer required. The discovery app requires no write scopes. The separate activity CLI requires `dropbox:folders:write` only when applying changes.

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

## 01C — single activity dates

`src/brightspace/activityWriters.js` handles Assignments, Quizzes and Discussion Topics: it reads the native activity, validates all three requested dates, preserves settings, updates and verifies. The discovery route remains read-only; the Assignment test form has separate protected POST routes. This operator command uses the configured Service User directly and is not a public endpoint.

After installing dependencies and configuring `.env`, preview without writing:

```sh
npm run activity:dates -- assignment 9524 983 '2027-01-01T09:00:00-03:00' '2027-01-02T23:59:00-03:00' '2027-01-03T23:59:00-03:00'
```

Those are example dates, not approved live-test values. Append `--apply` only when the target and dates are intended. Register `dropbox:folders:write` and include it in the operator environment's OAuth scopes for an apply run; retain the necessary read scopes and Service User permissions. No registration, scopes or live data were changed during implementation.

The result is `ready` (dry run), `unchanged`, `updated` (verified), or `failed`, with requested/verified dates and a sanitized error. Explicit availability types are preserved. Null types (including null Assignment Availability) use Brightspace’s configured course defaults when dates are added; invalid or missing type fields still block updates. See [TECHNICAL.md](TECHNICAL.md) for limits and live acceptance.

## Activity test form on Render

Deploy the updated `index.js` and complete `src/` folder, then relaunch through Brightspace. The page includes **Activity date test — 01C** below discovery.

Enter Course Offering ID `9524` and Assignment ID `983`. Enter three Brasília date-times, with Start earlier than End. Review the result, then choose **Apply these dates**. Assignments reject equal start/end dates. Preview makes no writes; apply uses exactly the previewed dates and re-reads/verifies the Assignment.

Applying requires `dropbox:folders:write` in the Brightspace OAuth registration and Render's `D2L_OAUTH2_SCOPES`, plus Service User edit permissions. Keep existing read scopes. Without the configured write scope, preview remains available but Apply is not offered. Restart after environment changes.

Confirmation tickets last ten minutes and are bound to the LTI session. This diagnostic uses in-memory tickets for a single-instance deployment. A restart or a request reaching another instance requires a fresh launch/preview. Production bulk execution needs persistent job state. No live dates were changed during implementation.

### Explicit and wildcard scopes

The web form and activity CLI share a scope matcher. For Assignment writes it accepts `dropbox:folders:write`, `dropbox:folders:*`, `dropbox:*:*`, and action lists such as `dropbox:folders:read,write`. Scope entries are separated by whitespace. Matching is exact within each component; unrelated scopes, read-only grants and `core:*:*` alone do not enable this local write control.

The matching scope must be in the app's `D2L_OAUTH2_SCOPES`, not only the Brightspace registration. This controls the local UI/CLI gate; Brightspace still enforces token grants and Service User permissions. OAuth scope requests and credentials are unchanged.

## 01C — Quiz and Discussion Topic testing

The LTI test form now includes **Activity type**, **Activity ID** and **Forum ID** (Discussion Topic only). Use discovery's `id` and `parentId` to identify a Discussion Topic. Course Offering ID remains explicit. Preview never writes; Apply uses the exact previewed request and performs read-back verification.

- Quiz scope: `quizzing:quizzes:write` or a covering wildcard.
- Discussion Topic scope: `discussions:topics:manage` or a covering wildcard.
- Assignment scope remains `dropbox:folders:write` or a covering wildcard.

Set scopes in both the OAuth registration and Render environment. Deploy updated `index.js` and all of `src/`, then relaunch through the LMS. Use ordered dates with Due strictly later than Start for Discussion Topics; the same-time shortcut has been removed.

The Assignment write has been confirmed live by the user, including Apply-only mutation. Quiz and Discussion Topic live tests are still pending. The Discussion read contract may omit calendar-display settings; this implementation blocks rather than defaulting those settings. If preview reports `DisplayInCalendar` or `DisplayUnlockDatesInCalendar` missing, provide the error for investigation; no update is sent.

## Local Mac API testing

A project-local Node 22 runtime is installed in `.local-tools/node` (ignored by Git). In Terminal:

```sh
cd "/Users/guilhermesimoni/Documents/ChatGPT/Brightspace Bulk Activity Date Manager"
export PATH="$PWD/.local-tools/node/bin:$PATH"
npm test
npm run check
npm run verify:discovery -- 9524
```

Fill `.env` with the existing Render API version, key ID and matching private key before live API calls. Keep secrets out of chat and version control. The template already has the tenant, OAuth client ID and native-tool scopes. Verify the token endpoint matches Render. Local API scripts need neither MongoDB nor an LTI launch; `npm start` still requires the full web configuration. The activity CLI is dry-run unless `--apply` is supplied. Do not deploy `.local-tools`, `.env` or `node_modules`; keep `package-lock.json` for reproducible installs.

Assignment previews now require **Start < End**; the API confirmed that equal start/end dates cause HTTP 400. Enter dates manually and use Preview selected dates.


### Unified terminal helper

`scripts/write-activity.js` calls the same `createActivityWriter` used by the app. Preview syntax:

```sh
npm run activity:dates -- assignment <courseId> <assignmentId> <startISO> <dueISO> <endISO>
npm run activity:dates -- quiz <courseId> <quizId> <startISO> <dueISO> <endISO>
npm run activity:dates -- discussionTopic <courseId> <topicId> <startISO> <dueISO> <endISO> <forumId>
```

Append `--apply` to save. Write scopes are `dropbox:folders:write`, `quizzing:quizzes:write`, and `discussions:topics:manage` respectively; equivalent wildcards are supported. Inputs require timezone-aware date-times. Assignment Start must precede End; Discussion Start must precede Due; all types require Start ≤ Due ≤ End.

`src/routes/activityDates.js` serves the shared form and protected POST endpoints `/diagnostics/activity-dates/preview` and `/diagnostics/activity-dates/apply`. Relaunch through LTI after deploying this rename to obtain a fresh form.

## CSV bulk updates

The LTI launch now includes **Bulk Activity Date Manager**. Upload a UTF-8 CSV (or paste its contents), select Start/Due/End in Brasília time, then choose **Validate and preview**.

```csv
OrgUnitId,OrgUnitCode
9524,
,COURSE_CODE
```

Use exactly one identifier per row. Numeric codes stay codes; leading zeroes are preserved. Both headers are required. IDs are checked through the Course Offering endpoint, and codes use exact lookup followed by the same check. Invalid/inaccessible/non-offering or ambiguous rows block the whole job. Duplicate inputs and ID/code aliases schedule the course once. Limits: 16 KB, 100 rows and 1,000 activities per job.

Validation and discovery run in the background without writes, including undated activities. A completed preview lists resolved courses, row issues, every activity, current dates and the requested dates. **Apply dates to these activities** confirms the saved plan; browser-submitted replacements cannot alter it. The preview expires after 30 minutes. New activities added after preview are not included. Changed dates produce a per-activity `STALE_PREVIEW` failure unless they already match the requested dates.

Results show updated, unchanged, failed and skipped activities. Use **My recent jobs** to return after closing the page and **Download CSV report** for row and activity results (UTC dates). Current/verified dates are displayed in Brasília time on the page.

### Configuration and operation

- Keep the existing LTI/OAuth settings and `MONGODB_URL`. Bulk jobs use separate `bulk_date_jobs` and `bulk_date_locks` collections in the existing application database; no ltijs collections are changed.
- LP API defaults to `1.49`; optionally set `D2L_LP_VERSION` to another supported version. Keep `D2L_LE_VERSION` configured.
- Course validation needs `orgunits:course:read`; code lookup needs `organizations:organization:read`. Existing discovery scopes are also required. Applying needs the relevant Assignment, Quiz and Discussion write scopes, including supported wildcard equivalents, plus Service User permissions.
- One bulk worker runs at a time across instances sharing the database and tenant/deployment namespace. Activities execute sequentially. Progress is persisted after each result. Transient GET failures have at most two retries, with bounded backoff and Retry-After handling; PUTs are never automatically retried.
- Authentication/permission, throttling and systemic connection failures stop remaining writes; isolated activity failures do not discard earlier successes. Bulk operations are not transactions and do not roll back successful updates.
- After worker loss, the 120-second lease expires and the next worker marks unfinished jobs interrupted. Saved successes remain; an in-flight activity is marked uncertain, and unscheduled ones are skipped. There is no automatic resume. Create a fresh preview to reconcile actual dates before applying again.
- Cancel is available before processing starts or while a preview is ready. It does not cancel an already-running write job.

Deploy the entire updated project and run `npm install` on Render (two direct dependencies were added: `csv-parse` and `mongodb`). Relaunch through LTI for the new workflow. The local tests cover CSV, resolution, planning, confirmation, execution, security and Mongo operation contracts. Live end-to-end bulk verification still requires a configured MongoDB connection and working OAuth token exchange.
