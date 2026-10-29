# Internal API contract

All domain access uses `/api/domain`. GET takes `resource` and bounded optional `id,q,library,page`/filters; POST uses `{op,...fields}`. Error shape is `{error:RomanianText,code}`. Domain bodies are limited to64KiB; auth bodies32KiB. Exact configured Origin is required on POST, with rate limits and a Better Auth-derived server actor. The caller cannot supply its acting member/role. Responses are private/no-store; only public aggregates enter the short bounded server cache, invalidated after mutation.

## Resources

Public: catalogue, libraries, library, work, legal, profile, opt-in leaderboard and anonymous me/config. Catalogue accepts title/author/ISBN plus genre/audience/availability/library/condition/language/publisher filters. Grouped works preserve edition and physical-copy identities/provenance. Public projection omits owner email, private collection notes, exact histories and hidden/paused/restricted copies.

Own/verified/scoped: mine, loans, messages, notifications, reports, reportPreview, reportEvidence, export, booksLookup, advisoryRank, forum/topic preferences, admin, moderation and moderationExport. `moderation` returns paginated scoped report metadata, pending photos and pending public review responses; it includes no case evidence, member lists, deployment settings or private inbox. Private conversations require participation; reported evidence requires case/library scope and each access is audited. Moderation export is paginated100cases, scoped/audited and omits inbox contents/contact evidence. No API grants unrestricted message browsing.

Main shapes:
- `catalogue:{works,total,page}`; `libraries:{libraries}`; `work:{work,editions,copies,reviews}`; `library:{library,works,counts}`.
- `me:{member,stats,libraries,config,avatars,notificationPreferences}` with null member when anonymous. Config is explicitly allowlisted, including non-secret upload limits/readiness and authorized preview status.
- `mine:{copies,reading,goals,stats,badges,challenges}`; `loans:{requests,loans,gifts}`; `messages:{conversations,messages,...pagination}`.
- `forum:{topics,categories,total,page}`; `topic:{topic,posts,total,page}`; `admin` contains only permitted queues/status/settings.
- `legal` production returns actual effective published documents and configured public operator contact; development may show explicit drafts. Future/null publication dates do not satisfy launch or acceptance.

## Operations

Profile: profile.update. Libraries: library.request/approve/reject/merge. Catalogue: catalogue.addCopy/merge/correct, copy.update/delete, photo.delete, moderation.coverSubmit/content. Lending: loan.request/accept/decline/cancel/handover/acknowledge/return/receive/extensionRequest/extensionApprove/dispute/resolve. Gifts: gift.offer/accept/decline.

Messaging: message.contact/accept/send/block/report. Reviews: review.book/member/respond/delete. Reading: reading.set, goal.set. Forum: forum.create/reply/edit/delete/like/bookmark/follow/read/moderate. Reports: moderation.report/update/appeal/publicAppeal. Administration: admin.role/suspend/warn/rewardAdjust/legalPublish/category/scope/privacyResolve/retryJob. Privacy: privacy.request. Notifications: notification.read. Banner preview: ads.preview.

Important fields/contracts:
- Loan actions use loanId or id; request decisions use requestId or id. extensionRequest returns extensionId; extensionApprove **requires that specific extensionId**. Approved ID replay is inert and cannot approve a later pending request.
- Message send requires conversationId, body and UUID clientKey. Same key/conversation/body returns the original message; differing reuse fails. Private report preview supplies a signed evidenceToken and explicit confirmed snapshot.
- gift.offer references the owner's active loan. Acceptance requires giftId and confirmPermanent:true, transfers the same copy once and leaves the recipient listing private.
- Book review uses workId and optional editionId (explicit null clears context). Transactions require actual recorded completed physical interaction.
- Cover moderation requires targetType:edition, targetId:editionId and submissionId for the individual rights-confirmed proposal. Photo/copy decisions are separate. Owner edits cannot clear a copy moderation hold.
- Reward adjustment requires memberId, signed points, reason and UUID idempotencyKey; original ledger entries are never overwritten. Failed-job retry requires its id and reason.
- admin.warn requires memberId and reason, with permitted libraryId if relevant. It stores/audits/notifies a warning; it does not change roles/status.
- privacy.request uses kindPrivacy or type (EXPORT/DELETE/CORRECTION); resolution uses id/state/reason. Pending requests deduplicate. Deletion is mediated and preserves unresolved physical records.
- Public service/appeal creates a new minimal contact case; a stated reportId is unverified and cannot expose/mutate the referenced report.
- ads.preview records authorized session expiry; query parameters cannot enable it.

## Authentication and files

Copy moderation approval clears a hold and preserves the owner's existing visibility. A PRIVATE copy remains PRIVATE; the owner explicitly chooses publication afterward. Rejection hides the copy and prevents owner relisting until authorised restoration. Member-review content/response moderation uses the original loan's library scope; approving a response sends `response:true` and changes response state only. Work/book metadata remains a global moderation action. Forum move omission preserves the current library; explicit `libraryId:null` selects global scope, and an approved library UUID selects that city. Both source/destination permissions and a valid category are required, with from/to audit metadata.

`/api/auth/*` wraps the supported Better Auth API. Public local signup additionally requires adult:true and acceptedTerms:true, strips those fields before library handling, then records actual current policy versions only for a genuine captured new-account ID. Google onboarding is separate. Browser JSON redacts bearer/provider tokens; session revocation takes an owned opaque sessionId. Administrator TOTP setup/step-up is private and verified.

`POST /api/uploads` is bounded authenticated multipart (copyId/file), processing one file under the concurrency gate. Actual content is decoded/re-encoded; no raw originals, SVG/ebook files, remote avatars or arbitrary remote image URLs. `GET /api/images/[key]/[width]` permits approved public content, its owner or audited case evidence under scope, with private/no-store caching.

Shared modules: typed `src/lib/config.ts`; parameterized `query`/`transaction` and bounded pool in `src/lib/db.ts`; supported `auth` in `src/lib/auth.ts`. Domain services enforce all permissions. Local test/demo fixtures exist only behind the isolated test harness, never a production fixture endpoint.
