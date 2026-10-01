# Product plan

## V1 product scope and architecture

Scope reset accepted October 1, 2026. This document governs future V1 work; the original folder retains 01A/01B. This project now retains authentication and native-only discovery.

### Objective

Apply one selected Start, Due and End instant to every Assignment, Quiz and Discussion Topic in each Course Offering listed in a CSV. Courses already contain their activities, populated upstream by the SIS/content-copy process. Process courses independently; there is no equivalent-activity matching across courses.

The intended UI is CSV upload plus three date/time pickers, validation summary, confirmation and results. Final UI is not implemented. The Assignment writer is implemented locally; live verification is pending.

### Impact assessment

| Decision | Existing components and consequence |
|---|---|
| ADD | Three native writers; explicit CSV input; Course Offering resolution/type validation; a server-side Batch Date Job; plan/execute boundary; bounded workers; retry policy; verification; per-row, per-course and per-activity results. |
| DEFER | Source Course deployment, content copying, cross-course matching, Schedule Blueprints, relative schedules, per-activity editing, hierarchy editing, and writes to Content Modules, Content Topics or Discussion Forums. |


### Module boundaries

Keep the current working layout compact:

```text
index.js
src/
  config/          database configuration
  brightspace/     authentication, API client, resource readers and mappings
  services/        native activity discovery
  routes/          diagnostic handlers
scripts/           read-only acceptance tools
test/              tests and JSON fixtures
PLAN.md            product scope and roadmap
TECHNICAL.md       contracts, safe writes and verification
```

The client owns pagination, URL/version validation and API errors. Activity normalizers own native field mappings, availability descriptions and record warnings. Separate resource readers remain small so resource-specific behavior stays easy to locate.

Create future modules only when implementing them: resource writers in `brightspace`, CSV validation and job orchestration in `services`, and application endpoints in `routes`. Keep parsing, planning and Brightspace payload handling separate without reserving empty folders. Split a module further only when its size or responsibilities warrant it. No new spike is implemented by this cleanup.

#### Current simplification

Source Course helpers, Content discovery, hierarchy and relationship resolution have been removed from this project at the user's request. The original project retains them. Native-only discovery is ready for the three V1 targets; forums serve only topic enumeration. Authentication remains unchanged. Future writes need a narrowly scoped transport and resource-specific payload preservation; the single-Assignment writer is now implemented, with live verification pending.

### Input and planning contract

Use explicit headers `OrgUnitId,OrgUnitCode`. Require exactly one nonblank identifier per data row. Trim surrounding whitespace; never classify a numeric code as an ID. Preserve code text, including leading zeros. Record source row numbers. Blank rows receive an explicit ignored-blank result; malformed headers/rows, invalid IDs, unknown or ambiguous codes, inaccessible offerings and other org-unit types receive structured errors. Flag duplicate rows and deduplicate again by resolved OrgUnitId so an ID and a code cannot schedule the same offering twice.

Resolve and validate every row before any write. Verify Course Offering type and service-user accessibility, not merely a positive numeric ID. Discover targets and calculate counts before confirmation. Proposed conservative default: unresolved validation errors prevent `ready`; valid-subset execution would require an explicit future product decision. Do not silently drop invalid rows.

Require all three timestamps. Convert local picker values using an explicit configured institution IANA timezone; reject ambiguous/nonexistent local times until an explicit disambiguation policy is chosen. Store UTC ISO instants and validate Start <= Due <= End. No silent rearrangement, inferred timezone, implicit clearing or ambiguous blank dates. Existing activities with null dates are still eligible targets.

### Job and result contracts

A server-side Batch Date Job owns `id`, `requestedDates`, validated courses, immutable confirmed plan, `status` and totals. States: validating, ready, running, completed, completedWithErrors, failed. Thousands of updates belong to this job, not independent browser requests. Persist progress through a repository abstraction; using a dedicated application collection in the existing database is a candidate, not a change to ltijs collections.

Track course counts and activity totals including updated, unchanged, failed and skipped. Per-activity results retain courseOrgUnitId, activityKey, type, name, requestedDates, verifiedDates (null when unread), status and sanitized error category/reason/resource. Per-course results retain OrgUnitId/code, discovery counts by target type, status and aggregate results. Do not count a successful PUT as updated until read-back verifies it. Retain row-to-course provenance for downloadable reporting.

Confirm the resolved plan and counts before execution. Execution uses bounded configurable concurrency across the whole job, including nested course/activity work; never unbounded Promise.all. Retry transient 429/5xx/network failures conservatively with capped attempts, backoff/jitter and Retry-After where available. Deterministic validation/permission failures are terminal for their target; systemic authentication or other unsafe conditions stop scheduling further writes. Preserve completed results and record unscheduled work. One isolated activity failure does not discard the batch.

Each writer re-reads the native object, builds its version-specific valid update body, changes only dates, preserves availability types and unrelated settings, writes, then reads back. Compare current dates first and return unchanged when equal. After an uncertain write outcome, reconcile by re-reading before retrying; do not blindly replay a stale full PUT body. Reruns use fresh state and skip already-correct dates. This supports convergence, not an exactly-once guarantee or automatic rollback. Restart/resume and concurrent-job conflict policies must be defined before production bulk execution.

LTI authorizes human access; the Service User performs API reads/writes. Preserve deployment/session validation and current LMS installation access control. Do not add the former user-ID allowlist. Decide any additional LTI role restrictions explicitly before production. Keep credentials and OAuth material server-side.

## Revised implementation backlog

Scope authority: [V1 product scope](#v1-product-scope-and-architecture), accepted October 1, 2026. No next spike is implemented by the reset.

| Stage | Status / deliverable | Completion evidence |
|---|---|---|
| 01A — LTI + server-to-server authentication | COMPLETE; retain architecture | Existing authentication, token-cache and deployment/database guard coverage |
| 01C — Safe native date writers | IN PROGRESS: Assignment writer and fixture tests implemented; live verification pending. Quiz and Discussion Topic writers next | Valid full update mappings, preservation fixtures, all three dates, null existing dates, unchanged detection, read-back mismatch and error tests; explicitly authorized controlled live write verification |
| 01D — CSV + Course Offering resolution | Planned | Explicit schema, row diagnostics, ID/code lookup, type/access checks, ambiguous/unknown codes, blanks, duplicates including ID/code aliases |
| 01E — Bulk execution engine | Planned | Durable server-side plan/job/results, validation-before-write barrier, confirmation binding, bounded concurrency, retry caps, partial failures, read-back verification and reruns |
| 01F — Minimal production UI | Planned | CSV + three date/time inputs, explicit timezone, validation summary, Cancel/Apply Dates, job progress/results and downloadable report |

### Implementation sequence

1. 01C: define requested-date validation and writer/result contracts. Confirm current tenant API payload requirements for the three targets. Add safe write transport and implement/test one writer at a time (Assignment, Quiz, Discussion Topic), retaining read-only diagnostics. Extract native-only discovery only where needed; keep native schema 3 discovery compatible. Do not build batch execution or final UI here.
2. 01D: implement parser independently, then Course Offering lookup/validation adapter and resolver. Test numeric codes without ID inference and deduplication after resolution. These services return validation results and never update dates.
3. 01E: implement plan construction first, then persisted job/result tracking, confirmation, bounded execution, retry/reconciliation and reruns. Target discovery includes undated activities and has no Content/Source Course dependency. Test that no write occurs before all CSV validation completes, and that concurrency stays bounded across courses.
4. 01F: connect the minimal UI to server-side jobs, not per-activity request loops. Define institution timezone and DST behavior, production LTI access policy, upload limits, reporting and restart/resume behavior before release.

### Decisions to settle within their owning spike

- 01C: exact supported tenant write contracts/scopes and preservation requirements; concurrency conflict handling for full-object PUTs.
- 01D: exact code lookup capability and duplicate-code policy; propose rejecting ambiguous resolution.
- 01E: job storage, queue/worker lifecycle, cancellation/resume, concurrent overlapping jobs, retry/concurrency defaults and plan freshness. Proposed default blocks execution on validation errors; any valid-subset mode must be explicit.
- 01F: institution timezone source, DST disambiguation, size limits and access restrictions. No ambiguous missing-date behavior: all three dates are required in V1.
