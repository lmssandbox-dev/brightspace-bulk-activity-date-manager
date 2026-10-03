# Delivery status

## Completed

- Activity discovery, normalization and native writers for Assignments, Quizzes and Discussion Topics.
- User-validated live preview/apply/read-back/unchanged behavior and CSV bulk date updates.
- Source mapping CSV, read-only preview, replica deactivation/verification, native deployment submission and saved results.
- Separate manual completion confirmation followed by activation/verification, including replicas initially inactive.
- One app with date-management and replication interface sections, organized into dates, replication and shared feature folders.

## Remaining

1. Deploy the reorganized source to the existing Render service and verify LTI launch, both sections and existing job history.
2. Test Source Course replication with explicitly approved source/replica IDs: preview without writes, prepare/deploy, verify actual completion in Brightspace, then manual activation and unchanged retry.
3. Verify the D2L-based interface in the deployed LTI frame; local browser and regression checks are complete.

No second service, database or LTI installation is required. Copy completion remains manually confirmed.
