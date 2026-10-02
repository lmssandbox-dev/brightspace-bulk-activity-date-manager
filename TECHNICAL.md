# Implementation

## Date feature: src/dates

activities contains native readers and normalizers. activityDiscovery combines supported activities. activityWriters maps native reads into safe update payloads for Assignments, Quizzes and Discussion Topics, preserves availability semantics/settings, writes once and reads back. Incomplete required settings block updates; uncertain transport outcomes are reconciled through read-back rather than blind PUT retries.

courseCsv parses and validates the input. activityDates provides single-activity preview/apply; discoveryDiagnostics provides read-only inspection. Existing route URLs are retained.

## Replication feature: src/replication

client validates actual Source Courses and replica offerings, updates course active state while preserving supported fields, and submits native LP sourceCourses/{sourceId}/deploy requests. Version-specific payload fields are checked. Read-back verifies status and preserved settings.

jobs parses mapping CSVs, performs read-only validation, prepares replicas, submits grouped deployments and executes separately confirmed activation. view renders mapping validation, saved results, confirmation forms and CSV reports.

A deployment ID confirms initiation, not copy completion. Unexpected or lost responses remain uncertain and are never resubmitted automatically. No copy-job-token inference, automatic copy polling or timed activation is implemented. Users verify completion in Brightspace before activating all mapped replicas.

## Shared infrastructure: src/shared

- auth.js: Private Key JWT token exchange and OAuth public keys.
- client.js: guarded API transport, pagination, native PUT transport and scope matching.
- id.js, courses.js, deploymentGuard.js: identities, course/source lookup and LTI launch-deployment restriction.
- database.js: dedicated database validation.
- jobs.js: common job lifecycle, date planning/execution and delegation to replication jobs.
- store.js: existing bulk_date_jobs and bulk_date_locks collections, ownership, confirmations and leases.
- routes.js: shared signed workflow actions, date bulk forms and delegation to the replication view.

One worker lease coordinates both workflows. Source/replica reservations protect unresolved deployment batches against overlapping bulk writes. Existing database records, namespace, configuration and endpoints remain unchanged; no data migration is needed.

Forms bind action, workflow, job, expiry and LTI session. Ownership is checked before access. Atomic confirmations prevent duplicate queueing. Saves are fenced by worker and running state. Interrupted work is retained for inspection. Activation retries preserve deployment results and reconcile current active states without redeploying. The activation action removes preview expiry and records manual completion confirmation.

HTML is escaped and CSV cells neutralize spreadsheet formula injection. API credentials are not returned in diagnostic output. Brightspace LTI installation governs user access; API permissions are those of the Service User.

Single-activity diagnostics/CLI do not participate in bulk course reservations; use them only when no overlapping bulk job is running.
