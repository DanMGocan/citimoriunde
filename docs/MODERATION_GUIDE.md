# Administration and moderation guide

Public registration is closed by default. Admin bootstrap must promote only the configured address after verified account control, use a one-time command, and never install a default password. Google credentials and the supported additional admin factor must be configured and validated before public launch. An email allowlist is not proof of account control.

Use the mobile-capable admin workspace for readiness/configuration diagnostics and actual case work. Deployment values are changed in the protected `.env` followed by the documented restart/rebuild command; the UI must show only safe effective values and secret-present flags. Ad preview is an authorised session state, not an environment editor or public URL switch.

## Permissions and evidence

Members may act on their own records and participant loans/conversations. Moderators require an explicit library/global scope for the target; ADMIN access is still audited. Every state-changing admin action needs actor, target, reason, time and an audit event. Do not open an unrestricted private-message view. A case reviewer can inspect only the minimal immutable reported snapshot, with each access logged.

The `/admin` workspace uses separate server resources: administrators receive `admin`; moderators receive the scoped `moderation` queue. Moderator tabs cover reports, photos/copy restrictions, reviews and forum actions. This queue does not contain member lists, roles, deployment settings, legal documents or jobs. Its bounded page controls provide access to older cases; permission checks apply independently to every decision.

Treat all physical confirmations as participant assertions. A review, avatar, XP level, verified email or Google login is not independent identity/safety evidence. Avoid labels such as thief, verified reader or trusted identity unless there is a lawful, accurate basis for them.

## Report workflow

1. Receive a report against a supported target; the public contact flow must permit illegal-content reports without an account. Rate-limit abuse without blocking urgent legitimate reporting or convicting by volume.
2. Triage to `TRIAGED`, assign a responsible reviewer and scope, and protect minimal necessary evidence. Escalate immediate credible threats through the operator's documented emergency process; the site is not an emergency service.
3. Record `INVESTIGATING`, useful facts, applicable rule, source and confidence. Do not gather unrelated inbox contents or publicise reporter identities.
4. Resolve or dismiss with a specific reason and proportionate action. Notify affected member and reporter appropriately; omit private evidence, confidential notes and unnecessary identities.
5. Accept an appeal, record `APPEAL_REQUESTED`, and use an independent reviewer where practical. Record a motivated result as `APPEAL_RESOLVED`. Do not make the original reviewer the sole judge of their own decision.
6. Export only necessary cases/actions for legal review with access restriction and an audit record; do not describe the presence of export/report buttons as DSA compliance.

## Loans, gifts and privacy

Suspension, blocking, a deletion request, copy visibility changes and catalogue correction must preserve active loans and historical actors. Route essential active-loan communication through a scoped mediated case when direct contact is blocked. Administrators should record evidence and reason for resolving disputed/lost outcomes; they must never automatically claim physical return or create a gift offer on an owner's behalf without authority.

A gift transfers the current physical copy only after current-owner offer and recipient acceptance; it closes DONATED, not RETURNED. Do not award both lifecycle rewards. Reward corrections use compensating entries with reasons; retain original ledger evidence. Suspicious loops are review signals, never proof based only on an IP address.

## Library and catalogue changes

A member's locality submission is a request. Approval creates the canonical locality/library transactionally or links to an existing one. Search pending/existing duplicates; justify rejection and notify the requester. Members cannot create canonical cities/categories through alternative endpoints. Seed reruns must not overwrite administrator edits.

For book duplicates compare work/author/translation/volume evidence. A matching title alone is insufficient. Preserve correct display diacritics and distinct editions, physical copies, loan references, reviews, aliases, redirects and audit history. Require a reason before a transactional merge; never accept an AI candidate ID without deterministic validation.

Hiding a physical-copy listing makes it private and places a moderation hold. Approval removes the hold while preserving its current visibility: a private copy, including a received gift, stays private. The owner must explicitly choose public listing afterwards. An already public copy stays public when approved. Neither decision confirms a physical handover/return, closes a loan or transfers ownership.

Pending public responses to transaction reviews appear as text cards in the mobile Reviews queue. Read the response, select visible or hidden, enter a specific reason and submit. These decisions send `response:true` and change the response's publication state separately from the original review. Manual review-ID controls also support a justified restoration decision. Review/report permissions follow the loan's recorded historical library, rather than either participant's current home library.

## Forum and photos

Forum moderation supports proportionate pin/lock/move/hide/restore and scoped warnings or suspension where implemented. Edits have a configured window and retained revisions; deletion uses a tombstone to preserve reply context. Public content must be reviewed for privacy exposure before allowing live ads. Photos are processed book images only: no avatars, executable formats, ebook files, public home addresses or documents in the frame.

Forum moves preserve the current library unless the operator explicitly selects another approved library or the global area. Both source and destination require moderation permission; a city-only moderator cannot move a topic globally or into another city without the corresponding scope. The server validates the category and active destination, rejects merged aliases and preserves hidden/locked/pinned state. Its audit entry records the original and resulting category/library with the reason. Topic controls and the mobile Forum tab use this same flow.

Warnings use `admin.warn` with the affected member, an explicit reason and permitted library scope. They persist separately, generate a reason-bearing private notice and audit event, and do not silently suspend/change roles. Held copy listings cannot be republished by an owner; only authorized content restoration removes the hold. Review publication and a particular edition-cover proposal must be decided separately.

The public `moderation.publicAppeal`/service-contact flow creates a new minimal case containing the stated reference and an explicit `contactControlConfirmed:false`. It cannot expose or mutate the referenced private report. The operator must establish contact control and entitlement before discussing private evidence or applying an appeal to an existing case. Signed-in reporters can request appeal of their own completed case; affected members can use the public mediated route. No unrestricted inbox or public report lookup is provided.

## Legal publication

The seed creates eight Romanian policy **drafts**. Fill actual operator/contact details from validated configuration, have the final policies reviewed, and publish a versioned database document with effective date and audit record. Record member acceptance of relevant versions separately from optional consent. Do not edit historic published versions silently. Keep applicable authority, complaint, copyright-takedown and retention procedures documented and staffed appropriately.

This guide specifies required safe operating practices. Consult TEST_REPORT.md and PROGRESS.md for the current implementation/test status before treating any particular admin control as verified.
