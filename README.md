# Brightspace Bulk Activity Date Manager

One LTI application with two workflow sections, deployed to one Render service. The existing LTI installation, OAuth configuration, MongoDB database and local `.env` are retained.

## 1. Activity dates

Upload or paste a UTF-8 CSV with headers `OrgUnitId,OrgUnitCode`. Supply exactly one ID or code per row; keep both columns in the header. The app accepts Course Offerings and actual Source Courses.

Enter Start, Due and End in Brasília time. Start must be before Due; Due must be on or before End. Validate and preview resolves every course and discovers Assignments, Quizzes and Discussion Topics, including undated activities, without changes. Apply writes the saved plan, reads dates back and records per-activity results. Return through My recent jobs or download the CSV report.

Limits: 100 CSV rows, 16 KB, 1,000 activities. Duplicates are processed once. Invalid rows or incomplete discovery block the plan. Previews expire after 30 minutes. Changed dates are rejected unless already equal to the requested dates. Availability modes and unrelated activity settings are preserved.

Read-only discovery and the single-activity preview/apply form remain available for troubleshooting. All three activity writers and the CSV date workflow have been validated live by the user.

## 2. Source Course replication

Upload a second CSV with headers `SourceOrgUnitId,ReplicaOrgUnitId`. Both IDs are required on each row. Repeat the source ID for multiple replicas. Sources must be actual Source Course org units; replicas must already exist as Course Offerings. Replicas may initially be active or inactive.

1. Validate deployment mappings performs reads only and saves a plan.
2. Confirm Prepare and deploy. Every replica is deactivated and read back before any native deployment is submitted. Brightspace resets the target content as part of deployment. Submission IDs and results are saved.
3. Wait for copying to finish in Brightspace. You can close the browser. Submitted means accepted, not finished; the app does not poll copy completion or activate after a timer.
4. Return through My deployment jobs. Check every copy, resolve failures/uncertain outcomes, and confirm Activate replicas. All mapped replicas are activated, including those originally inactive, with read-back verification.

Limit: 100 rows / 16 KB. Duplicate mappings are processed once. Conflicting sources for a replica, self-deployment and source/replica overlap block the preview. If preparation fails, already-deactivated replicas remain inactive with saved results. Inspect them before restoring service; there is no automatic rollback. Activation retry checks current state and does not redeploy.

Finish source date changes before replication. Saved unresolved deployments reserve involved courses against overlapping bulk jobs in this application. Live Source Course deployment/activation acceptance is still pending; no live replication was executed during the file reorganization.

## Project layout

```text
index.js                 One app entry point
src/
  dates/                 Activity readers, normalization, discovery and date writer
    activities/          Assignments, Quizzes, Discussions and normalizers
  replication/           Source validation, deployment, activation and its view
  shared/                LTI/OAuth helpers, API transport, database and job infrastructure
scripts/                 Local discovery and single-activity CLI tools
test/                    Automated tests and JSON fixtures
```

The folders separate features, not deployments. There is no second Render app, database or LTI installation to create. Keep `test/`, package.json and package-lock.json. README describes operation; TECHNICAL describes implementation; PLAN records remaining work.

## Configuration and deployment

Use Node.js 22. Run `npm ci`, `npm test`, `npm run check`, then `npm start`. Upload the entire current project source to the existing Render service. Do not upload `.env`, private keys, `.local-tools` or node_modules. Do not overlay only selected renamed files: use this complete source layout.

The existing `.env` is unchanged. For new environments use `.env.example`. MONGODB_URL must explicitly select `brightspace_activity_date_manager`. Keep LTI_KEY and the OAuth signing key/key ID stable across restarts. BS_CLIENT_ID and BS_DEPLOYMENT_ID must match the existing Brightspace installation. LTI controls who launches the app; API requests use the configured Service User's permissions through Client Credentials with Private Key JWT.

Existing endpoints stay the same: `/login` for OIDC login, `/` for target link, `/keys` for LTI public keys, `/.well-known/brightspace-jwks.json` for OAuth public keys, and `/ping` for health checks. No public endpoint writes Brightspace data.

D2L_LE_VERSION must be supported (at least 1.90). Source replication needs D2L_LP_VERSION=1.53 or later. Date writes need `dropbox:folders:write`, `quizzing:quizzes:write` and `discussions:topics:manage`; replication needs `manageCourses:deploy:manage` and `orgunits:course:update`, alongside the required read scopes and Service User permissions. Matching resource/action wildcards are supported. LP 1.54+ also requires locale/address-book fields in course read responses for safe status updates.

## Local diagnostic CLI

`npm run activity:dates -- <assignment|quiz|discussionTopic> <courseId> <activityId> <startISO> <dueISO> <endISO> [forumId] [--apply]`

Preview is the default; Discussion Topics require the forum ID. The CLI uses the same writers and OAuth configuration, without an LTI launch or MongoDB. `npm run verify:discovery` runs the discovery verification script. These are development tools; use the saved-job UI for bulk work.
