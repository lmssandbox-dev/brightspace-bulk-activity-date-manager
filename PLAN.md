# Product plan

## Scope

Apply one selected Start, Due and End instant to every Assignment, Quiz and Discussion Topic in each Course Offering listed in a CSV. Existing undated activities are included. Courses already contain their activities; there is no cross-course activity matching or content copying.

LTI controls human access through the LMS installation. The existing OAuth Service User performs API operations. No user-ID allowlist is introduced. Content, Discussion Forums, Source Courses, relative schedules and per-activity date editing remain outside bulk scope.

## Current stages

| Stage | Status |
|---|---|
| 01A — Authentication | Complete; architecture retained |
| 01C — Native writers | Complete; user confirmed live preview/apply/unchanged behavior for all three types, including undated Assignment 1058 and Discussion Topic 868 |
| 01D — CSV and Course Offering resolution | Implemented; explicit ID/code columns, exact code lookup, offering/access validation, row diagnostics and deduplication |
| 01E — Bulk execution | Implemented; durable plans/results, atomic confirmation, serial execution, worker lease, stale-date guard and interrupted-job handling |
| 01F — Minimal workflow | Implemented; upload/paste CSV, three date inputs, preview, Apply, progress/history and CSV report |

Bulk implementation is locally tested. Live bulk end-to-end acceptance remains outstanding: local MongoDB is not configured and the latest token exchange returned invalid_grant. No bulk live updates have been attempted.

## Execution choices

- CSV: `OrgUnitId,OrgUnitCode`, exactly one nonblank identifier per row; no numeric-code inference. Validation errors block the entire job.
- Limits: 100 CSV rows, 16 KB, 1,000 activities. Existing date/availability semantics are preserved by the shared writer; explicitly null availability uses configured course defaults.
- Timezone: Brasília (`America/Sao_Paulo`), with existing date-picker round-trip validation. All dates are required; bulk requires Start < Due <= End to satisfy Discussion Topic rules.
- Preview expires in 30 minutes and freezes activity identities. The writer reads fresh native settings and rejects changed dates. Already-correct dates return unchanged.
- Storage: dedicated MongoDB application collections, separate from ltijs. Access is bound to the authenticated LTI user and deployment. Session-bound signed forms protect actions; Apply uses an atomic ready-to-queued transition.
- One global bulk worker per tenant/deployment runs sequentially. GET retries are bounded; PUTs are never blindly repeated. Existing single-activity diagnostics remain available but should not be used concurrently on bulk targets.
- Systemic API failures stop further writes. Isolated failures retain other results. No automatic rollback or resume. After interruption, reconcile using a fresh preview.

## Next acceptance

1. Deploy with existing MongoDB and OAuth configuration, including course-read scopes.
2. Preview a CSV containing a known course ID and its code; verify one resolved course and correct counts, including undated activities.
3. Try invalid, ambiguous and non-offering identifiers; ensure Apply is absent.
4. Confirm an approved test batch; inspect per-activity read-back results and the LMS.
5. Repeat the same dates and confirm unchanged. Check duplicate Apply, history/report access and interruption recovery in an isolated test environment.

Future work: larger-scale job storage and paging, explicit cancellation during execution, operational monitoring/retention policy, and stronger coordination with edits made outside this application. These are not claimed as implemented.


## Second workflow: Source Course deployment

User requirement: deploy actual Source Course org units into existing production offerings supplied by CSV, using the native clean reset/deploy behavior. Implemented locally: mapping validation, source grouping, inactive-target checks, explicit reset confirmation, durable submission tracking, partial/uncertain outcomes, and manual outcome review. Date preparation now permits genuine Source Courses. This supersedes the earlier exclusion of Source Courses from future scope; Content and Forum date writes remain excluded.

New requested extension: support active replicas by deactivating first and activating all successful replicas after completion, regardless of initial state. Automatic activation is not implemented. A successful deployment POST only confirms initiation; a trustworthy Source Course deployment completion signal must be established, or a separate manual completion-confirmation gate used. Fixed-delay activation is not considered confirmation. No live deployment has been executed.
