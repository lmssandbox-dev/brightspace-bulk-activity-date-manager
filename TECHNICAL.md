# Technical reference

Current discovery, future native write requirements and verification procedures. The Assignment writer is implemented; Quiz and Discussion Topic writers remain planned.

## Native discovery contract — schemaVersion 3

Only `assignment`, `quiz` and `discussionTopic` appear in `activities`. Each activity retains `key` (type:orgUnitId:id), type, id, parentId, name, orgUnitId, dates `{start,due,end}`, availability `{startType,endType}`, identity `{activityId}` and lightweight metadata. Dates are UTC ISO instants or null. Availability retains raw values and readable mappings: 0 AccessRestricted, 1 SubmissionRestricted, 2 Hidden; missing, unspecified and unknown remain distinct.

The response contains schemaVersion, orgUnitId, complete, sources, activities, counts (allActivities, datedActivities, returnedActivities), warnings and opt-in redacted raw responses. Core discovery includes undated activities by default. The diagnostic defaults to dated-only display.

Schema 3 removes Content relationships, hierarchy, Content objects and normalized Forums. No Content or Source Course API calls occur. Forums are enumerated to obtain topic IDs; invalid forum dates are irrelevant, but invalid IDs make discovery incomplete. Duplicate forum IDs are traversed once. Native duplicate keys produce warnings and one retained activity.

Pagination, strict dates, secret redaction and partial resource failure reporting remain. Invalid native records produce warnings. Authentication/authorization errors, throttling, transport failures and collection 400/404 remain top-level errors; resource 500s can yield explicit partial results. LE >=1.90 is required. Diagnostics remain read-only and LTI/deployment protected. OrgUnit type validation is planned in 01D, not claimed by this reader.

## Future write adapters — design notes only

V1 targets are Assignment, Quiz and Discussion Topic only. Assignment implementation is described below.

Discovery remains read-only; the protected Assignment form and operator command can issue PUT with explicitly configured write scope. The domain model is intentionally insufficient to reconstruct complete Brightspace update bodies. A future writer must re-read the current native object, map it to the configured API version's update contract, preserve unrelated fields and availability semantics, apply only requested changes, write, then re-read and verify. Never use a Content placement to update a native Assignment/Quiz/Discussion. Never accept a complete native payload from a browser.

The V1 request identifies a canonical activity and requires all three dates. Missing/null requested dates are rejected; date clearing and partial date updates are not implemented. Validate identity, authorization, dates and ordering at write time. Re-reading reduces stale-data risk but does not make concurrent edits atomic; concurrency/version handling remains a 01C design task.

### Native tools

| Type | Re-read/update target | Non-date settings the future adapter must preserve |
|---|---|---|
| Assignment | `dropbox/folders/{id}` | Map DropboxFolder to DropboxFolderUpdateData: name, category, instructions, group type, calendar/hidden flags, notification email, assessment denominator, anonymity, submission/completion/dropbox types, grading and special-access settings; include version-specific submission rule. Preserve both availability types in the nested availability block. |
| Quiz | `quizzes/{id}` | Map QuizReadData to QuizData: name, activation, order, grading, instructions/description/header/footer, calendar flag, attempts, timing/late-submission settings, password, navigation/display restrictions, IP limits, category, special access and newer version-specific options. Read and write shapes differ (for example, AttemptsAllowed versus NumberOfAttemptsAllowed); copying a read object verbatim is unsafe. |
| Discussion Topic | `discussions/forums/{parentId}/topics/{id}` | Map Topic to CreateTopicData: name/description, anonymity, moderation, scoring/auto-score, ratings, participation, hidden/locked/calendar flags and group association. Preserve availability types; do not repurpose legacy unlock fields as ordinary start/end dates. |

This table identifies preservation groups, not an executable payload schema. The version-specific adapter must enumerate the complete writable schema at implementation time and reject insufficient re-read data. Some read properties depend on permissions and cannot safely be defaulted.

Assignments distinguish an absent/null availability block from a dated restriction, and omitting availability types can apply tenant defaults. Quiz updates replace associated properties, so partial UI data is not a safe body. Discussions may clear dates when null or omitted in update structures. Discussion topic due dates require LE 1.90+. RichText read objects and RichTextInput write objects require explicit conversion.

Primary contracts: [DropboxFolderUpdateData](https://docs.valence.desire2learn.com/res/dropbox.html#Dropbox.DropboxFolderUpdateData), [QuizData](https://docs.valence.desire2learn.com/res/quiz.html#Quiz.QuizData), [ForumData and CreateTopicData](https://docs.valence.desire2learn.com/res/discuss.html).

### Endpoint and scope inventory (future writes only)

All paths below are relative to `/d2l/api/le/{version}/{orgUnitId}/`. Every detail target supports GET for re-reading and PUT for the future update. These write permissions are documentation only; the app requests read permissions exclusively.

| Type | Discovery GET | Detail GET / future PUT | Read scope | Future write scope | IDs |
|---|---|---|---|---|---|
| Assignment | `dropbox/folders/` | `dropbox/folders/{folderId}` | `dropbox:folders:read` | `dropbox:folders:write` | OrgUnitId, folderId |
| Quiz | `quizzes/` | `quizzes/{quizId}` | `quizzing:quizzes:read` | `quizzing:quizzes:write` | OrgUnitId, quizId |
| Discussion Topic | `discussions/forums/{forumId}/topics/` | `discussions/forums/{forumId}/topics/{topicId}` | `discussions:topics:readonly` | `discussions:topics:manage` | OrgUnitId, forumId (parentId), topicId |

Assignment date payload fields are `Availability.StartDate`, `Availability.EndDate`, their availability types, and `DueDate`. Quizzes use `StartDate`, `DueDate`, `EndDate`. Discussion Topics use `StartDate`, `DueDate`, `EndDate` and availability types at LE >=1.90. Preserve the non-date groups described above. Explicit nulls can clear dates; omitted fields must never be assumed to preserve current state in a PUT replacement contract.

Check the configured version against the official [scope inventory](https://docs.valence.desire2learn.com/http-scopestable.html) and the resource contracts linked above when implementing 01C. An Assignment adapter now exists; the other two remain planned.

## Native-only discovery acceptance

Automated fixtures cover the three native types, null and individual date combinations, availability semantics, pagination, duplicate identities, invalid forum IDs, ignored forum dates, partial errors, authentication failures and diagnostic authorization. Integration tests assert there are no Content or Source Course requests.

With installed dependencies and configured OAuth environment, run `npm run verify:discovery -- 9524` or provide multiple known Course Offering IDs. The command is read-only. It checks dated and undated examples of each native type, start/due/end-only cases, assignment availability values 0/1/2, identities and warnings. Missing matrix cases fail acceptance; an empty course is not a passing acceptance fixture.

The runner assumes the operator supplied Course Offering IDs; type resolution is future 01D work. Live verification of this simplified schema 3 is pending deployment. Previous 01B live evidence and the complete auxiliary implementation remain in the original project. No Source Course run is required in this project.

## Implemented Assignment writer

Contract: `createAssignmentWriter({api, put}).updateActivityDates({orgUnitId, activity, dates, dryRun})`. Activity must identify an Assignment and, if supplied, its key/course must agree. `dates` requires start, due and end timezone-aware instants, ordered without losing sub-millisecond precision. The CLI defaults to dryRun; internal calls default to execution.

The payload explicitly maps DropboxFolder to DropboxFolderUpdateData, converts RichText instructions to RichTextInput, retains availability types, and includes SubmissionRule for LE >=1.98. It does not replay read-only fields. Missing core preservation settings or null/unknown availability types block the write rather than applying defaults. Fields documented to preserve their current value when omitted are not required in the read response. An undated Assignment is supported when its availability types are known. This restriction needs validation against the real tenant before broad execution.

The Assignment-only transport restricts PUT URLs to the configured HTTPS tenant, LE version and native Assignment detail path. It uses the existing OAuth cache, a timeout and no redirects. No automatic PUT retries occur. After any PUT outcome, the writer reads back; requested dates and writable non-date settings must match before returning updated. A failed verification has `writeAttempted: true`; it does not imply the original write was rolled back. A lost response followed by successful verification returns updated with `reconciled: true`.

Returned settings are compared conservatively; server-side formatting changes can produce SETTINGS_CHANGED requiring inspection. Full-object read/modify/PUT is not atomic, so concurrent human edits can still be overwritten between read and write. Use an isolated test activity; concurrent-job coordination remains future work. Rubrics/attachments are excluded from the update payload, rather than recreated. No bulk retry, rollback or exactly-once guarantee is implemented.

Live acceptance target supplied by the user: Course Offering **9524**, Assignment **983**. Requested dates/timezone are still pending. Local code has no configured credentials/dependencies; the operator command must run in a configured environment. No live update has been performed. Run dry first, inspect the result, apply the intended values, then rerun to verify unchanged; manually confirm instructions, grading, visibility and availability in the LMS. Quiz and Discussion Topic writers follow once this writer is accepted.

Sources checked October 1, 2026: [Assignment read/update contract](https://docs.valence.desire2learn.com/res/dropbox.html#Dropbox.DropboxFolderUpdateData) and [RichTextInput](https://docs.valence.desire2learn.com/basic/conventions.html#term-RichTextInput).

## LTI Assignment test form

`src/routes/assignmentDates.js` provides protected POST preview/apply handlers. Both check the validated ltijs session and deployment. Forms carry the LTI token in the POST body. Random server-side tickets expire after ten minutes and are bound to a hash of the session. Apply consumes its ticket before awaiting the writer and ignores replacement IDs/dates submitted by the browser. It uses the stored preview values.

Date-time inputs use explicit Brasília UTC−03:00 with IANA timezone round-trip validation. Now captures one instant at preview time, fixed through apply. Results are escaped, non-cacheable and use no-referrer policy. Scope availability is enforced server-side. No raw Brightspace payload is accepted from the browser.

The bounded in-memory tickets target single-instance testing, not distributed production execution. Restarts or another instance invalidate a confirmation. Browser/live acceptance on Render remains pending deployment.

### Optional Assignment fields

The writer no longer requires every documented read property to be present. Missing IsHidden, IsAnonymous, DropboxType, SubmissionType, CompletionType, GradeItemId, AllowOnlyUsersWithSpecialAccess and Assessment are omitted under the documented preserve-current update semantics. At LE >=1.98, missing SubmissionRule is sent as null (documented leave-unchanged behavior). Core fields without that guarantee still block writes, now reporting their names in `error.fields` and the message. No defaults are guessed. Exact fields missing from the reported tenant response were not supplied, so live resolution still needs preview verification.

### Explicit and wildcard scopes

The web form and Assignment CLI share a scope matcher. For Assignment writes it accepts `dropbox:folders:write`, `dropbox:folders:*`, `dropbox:*:*`, and action lists such as `dropbox:folders:read,write`. Scope entries are separated by whitespace. Matching is exact within each component; unrelated scopes, read-only grants and `core:*:*` alone do not enable this local write control.

The matching scope must be in the app's `D2L_OAUTH2_SCOPES`, not only the Brightspace registration. This controls the local UI/CLI gate; Brightspace still enforces token grants and Service User permissions. OAuth scope requests and credentials are unchanged.
