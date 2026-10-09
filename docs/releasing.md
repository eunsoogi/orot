# Orot release process

This repository currently admits `v0.1.0` only. Release automation creates a GitHub Release after validating the exact main commit, its successful main CI run, issue evidence, and a human approval recorded on the candidate pull request. The simulator product is `Orot.app` with display name `Orot`; CI simulator builds are test evidence only. This process does not create an installable iPhone IPA or submit to TestFlight or the App Store.

## 0.1.0 scope

The release gate follows the expanded 0.1.0 acceptance criteria in [issue #42](https://github.com/eunsoogi/orot/issues/42), including requirements added after the original reduced flow. Verify the recording, import, appointment, and Korean visit-question path together with the current acceptance criteria for #98–#111, #113, #116, #117, and deletion #34. A closed child issue does not replace integrated evidence on the final #42 release candidate.

The release includes Orot's directly implemented RAG (#23–25) and the separate external open-source agent-memory subsystem (#61), Korean-only i18n (#59), Apple Intelligence (#62), ChatGPT OAuth, LangChain, LangGraph, LangSmith, and no Orot backend. Keep RAG retrieval and agent memory as separate requirements. The initial synthetic LangSmith evaluation on issue #36 is required evidence; comparative full-context versus custom-RAG evaluation #41, manual symptom/history entry, general health review, and other 0.2.0 work are not 0.1.0 release gates.

## Verification requirements

| Area | Required evidence before release |
| --- | --- |
| Integrated local flow (#30, #32, #34, #42) | Exercise the real app UI and local storage for recording consent, timestamped transcript review, selected health data, selected Calendar candidates, explicit appointment confirmation, and Korean visit questions grounded in linked records. Cover deletion and dependent memory cleanup, offline local behavior, Apple availability, explicit remote errors, no silent provider fallback, and the absence of an Orot backend. |
| UI requirements from device feedback (#98–#110) | Recheck each issue's criteria for safe areas, scrolling, swipe cancellation, unsaved-work confirmation, visual/accessibility settings, batched HealthKit and EventKit import with independent progress and measured privacy-safe timings, original-audio versus corrected-transcript export and temporary-file cleanup, provider-based appointment classification with manual fallback, and the four home-screen features. Record the iOS version and test surface for each result; use an actual UI timing observation for #100 rather than API call counts alone. Keep the app iOS-only (#104). Do not treat separately existing screens or unit fixtures as the integrated flow. |
| RAG and agent memory (#23–#25, #61, #109) | Exercise Orot's direct retrieval and source citations separately from persistent memory recall, correction, deletion, and workflow restart/resume. Include missing or conflicting evidence, original source navigation, uncertain disease hypotheses with supporting and contrary evidence, and external medical-source provenance where those features are exposed. |
| Provider lifecycle (#62, #99, #113) | Exercise Apple Intelligence and ChatGPT OAuth routes where the Simulator supports actual execution, including callback, cancellation, existing session, and relaunch states. Record the real provider configuration and result or the observed OS/access blocker separately from CI's fake auth adapter. Verify sign-out races, local credential cleanup, signed-out request rejection, relaunch, and sign-in again without silently switching providers or deleting health records. The earlier live-account waiver on closed issue #8 does not satisfy #42 evidence. |
| iCloud device backup and restore (#116) | Inventory permanent recordings, transcripts, health and appointment records, app-retained Calendar data, generated questions and AI results, provenance links, settings, RAG state, and agent memory; distinguish originals from rebuildable state, secrets, and temporary files. Use an authentic iCloud backup and new-device restore with a real account; record account, device, storage, or paid-storage prerequisites observed. Verify encrypted database and recording-key recovery without disabling encryption or backing up auth tokens, original recording and provenance relationships, restored or rebuilt derived state, deletion, reimport, tombstone behavior, and unavailable/incomplete/failed restores. Prevent automatic reimport or reindexing from resurrecting deleted records, and explain that an older snapshot can restore data deleted after that snapshot. Do not display backup completion unless the app can observe it. Simulator eligibility and file flags do not prove an OS-managed transfer. |
| Collaborative execution (#117) | After integration with #30, #108, and #109, exercise actual provider-neutral role handoffs, bounded tools/retries/payloads, consent bound to the selected provider and payload with renewed consent after material expansion, confirmation, cancellation, restart/resume, failure recovery, source-linked results with revisions/time ranges/units/coverage, and termination without duplicate side effects or unsupported medical certainty. Distinguish personal records, reviewed memory, model inference, and external medical sources. Synthetic fixtures prove deterministic behavior only, not live-provider execution. |
| Project introduction (#111) | Ensure the README describes the integrated, verified architecture and distinguishes implemented behavior from plans. Recheck it after dependent feature work merges. |

### Current main snapshot

This comparison is anchored to `main` at `0c2ec2453076cd8ba04b2daf9b099d72ff2366d5` (2026-10-08); refresh it after integration changes. Issue #42 is open and has no evidence comment. Issues #98, #104, and #105 are closed; #99–#103, #106–#111, #113, #116, and #117 remain open. PRs #123 and #140 are merged, but their related issues #99, #113, and #111 still need the #42 integrated verification described above. PRs #121, #125, #126, #141, and #142 remain open drafts.

| Current main evidence | What it proves and what remains unproved |
| --- | --- |
| `apps/mobile/App.tsx` mounts recording, separate HealthKit screens, Calendar linking, and provider selection. The README's [feature integration table](../README.md) says the four AI feature services/screens are not connected through `App.tsx`; `FeatureEntryScreen` is not used there. | Individual entry points exist, but they do not prove the expanded #42 user flow or the four features working together in the app. |
| `apps/mobile/e2e/release-e2e-suite-files.js` runs smoke, safe-area, appointments, agent-memory, graph, checkpoint, and storage suites. The required Detox workflow also runs separate agent-memory, graph, checkpoint, and synthetic OpenAI-provider probes; the provider probe reports `realAccount=unverified`. | The required CI has separate probe coverage, but not the combined #42 app flow, an actual OAuth account result, iCloud restore, or integrated collaborative-role handoff. |
| `apps/mobile/ios/OrotMobile/RecordingFileStore.swift` marks permanent recordings as excluded from backup, and `apps/mobile/src/recording/recordingPersistence.ts` requires that exclusion. Draft PR #121 is not on `main`. | Current main cannot establish #116 backup and restore. Apple distinguishes device backup snapshots from CloudKit synchronization and describes `isExcludedFromBackup` as system guidance, not proof of a successful transfer ([iCloud Backup and CloudKit](https://developer.apple.com/documentation/cloudkit/deciding-whether-cloudkit-is-right-for-your-app), [backup file guidance](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup), [backup security](https://support.apple.com/guide/security/icloud-backup-security-sec2c21e7f49/web), [restore steps](https://support.apple.com/en-us/118105)). The #116 restore must also prove Orot's own encrypted-data key recovery. |
| `packages/agent-runtime/src/modelProviderGraph.ts` has one `generate` node between `START` and `END`; #117 remains open. | Provider invocation and deterministic graph tests are not evidence of domain-role collaboration or an integrated #42 handoff. |
| Readiness schema v1 links only `simulatorE2E` (#42), `evaluation` (#36), `deletion` (#34), and `telemetry` (#40). Those four issues are currently open. | The schema and validator do not include #116 or #117 and do not evaluate every #42 criterion. Required #116/#117 evidence must be checked independently before publication; `knownLimitations` cannot waive it. |

The `simulatorE2E` readiness field is a legacy evidence key, not a restriction of #42 to Simulator-only verification. A required synthetic CI adapter remains separate from actual provider and iCloud results. The Release E2E suite must include the integrated synthetic scenarios when the app flow is ready, while the authentic provider and iCloud evidence stays separately identified.

For workstation setup and the pinned development commands, see [Development setup](development.md).

## CI checks

Pull requests targeting `main` and every push to `main` run the repository-owned `node scripts/ci/check-loc.mjs --base <commit>` policy check and the existing commands: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm ios:build`, `pnpm e2e:build:ios`, and `pnpm e2e:test:ios`. The complete quality inventory, including clang-format, runs on Linux x64. The `Quality` aggregate runs the LOC check on Linux; on pull requests it uses the actual base commit, and on a push to `main` it uses the previous main commit so the integrated change is checked.

The `Quality` job of workflow `CI` runs the LOC check on Linux and requires the full Linux quality job to succeed. Release validation requires a successful `Quality` result for the exact source commit, plus successful `iOS Simulator Build` and `Detox iOS E2E` results. The `Quality` aggregate fails if its LOC check fails or the Linux quality job fails, is cancelled, is skipped, or is missing. Branch protection must require the check names emitted by these jobs. Dependency installation remains frozen. The unit job rejects missing, zero-test, skipped, pending, or todo results. The Detox job builds and launches the app in an iOS Simulator and retains test output, failure screenshots, recordings, and app logs for 14 days.

The iOS jobs use GitHub's `xcode-27` public-preview runner for production, Release, and OpenAI Debug, and `macos-26` for Speech Transcription. The observed macOS release is recorded in cache keys and evidence, but is not a compatibility gate. Each profile still verifies its exact Xcode, Simulator SDK, runtime, and device: production, Release, and OpenAI Debug use Xcode/iOS Simulator SDK 27.0; Speech Transcription uses Xcode/iOS Simulator SDK 26.2. All profiles also verify Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, and CocoaPods 1.17.0 exactly. The workflow installs pinned pnpm before `setup-node` initializes its lockfile-keyed cache. The Detox job builds Detox's versioned iOS framework and XCUITest-runner cache for the selected Xcode/Detox versions. It also installs [AppleSimulatorUtils](https://github.com/wix/AppleSimulatorUtils) 0.9.12 from the Wix Homebrew tap, trusts only that formula, and checks the reported version; Detox requires this utility to control the iOS Simulator. A successful simulator run does not prove physical-device behavior, signing, distribution readiness, or iCloud backup/restore. The integrated #42 Detox suite must use deterministic synthetic fixtures and an explicitly test-only fake model/auth adapter, without application or provider credentials. Record that fake boundary in the #42 evidence, separate from the actual provider-auth result. Exercise actual provider routes where the Simulator supports them; report a concrete blocker and observed access result on #42 and the owning provider issue when it does not. The closed #8 live-account waiver is not proof for the newer #42 requirement. The authentic #116 iCloud backup and new-device restore remains mandatory; report any other unverified device behavior, including HealthKit, microphone, and speech, separately. Do not put credentials or personal health data in test output or artifacts.

## Dry run

Run **Release** from the `main` branch using **Actions → Release → Run workflow**. Keep `mode` at `dry-run`, enter version `0.1.0`, the full main commit SHA, and the run ID of the successful `CI` push run for that exact SHA. Leave readiness evidence empty until the release gates are complete. The workflow reports that publication is blocked and performs no tag or release write when evidence is missing.

The dry run checks workflow ref, source SHA ancestry on `main`, package version, immutable tag state, actual CI run metadata, and the `Quality`, `iOS Simulator Build`, and `Detox iOS E2E` results. Both dry-run and publish modes require the `Detox iOS E2E` result; a missing or mismatched AppleSimulatorUtils installation fails that job and keeps release validation blocked. If readiness JSON is supplied, the dry run also validates the evidence and approval without publishing. A mismatched version, failed or skipped CI job, stale tag, or existing release fails closed.

## Readiness evidence

`publish` requires a JSON object with this shape. Values must link to actual GitHub records, not placeholders. Each evidence comment must belong to the specified closed issue and include the exact source commit SHA. Do not include credentials, patient details, screenshots containing personal information, or other health data in the JSON or linked comments.

```json
{
  "schemaVersion": 1,
  "version": "0.1.0",
  "sourceCommit": "<full main commit SHA>",
  "ciRunUrl": "https://github.com/eunsoogi/orot/actions/runs/<successful run ID>",
  "evidence": {
    "simulatorE2E": { "url": "https://github.com/eunsoogi/orot/issues/42#issuecomment-<id>" },
    "evaluation": { "url": "https://github.com/eunsoogi/orot/issues/36#issuecomment-<id>" },
    "deletion": { "url": "https://github.com/eunsoogi/orot/issues/34#issuecomment-<id>" },
    "telemetry": { "url": "https://github.com/eunsoogi/orot/issues/40#issuecomment-<id>" }
  },
  "knownLimitations": [
    "Physical-device HealthKit, microphone and speech behavior remains unverified where not exercised; the mandatory #116 iCloud backup and restore is recorded separately.",
    "CI produces no signed distribution artifact."
  ],
  "candidateApproval": {
    "pullRequestUrl": "https://github.com/eunsoogi/orot/pull/<merged candidate PR>",
    "reviewId": 123456,
    "reviewerLogin": "<non-author reviewer>",
    "approvedAt": "<GitHub review submitted_at timestamp>"
  }
}
```

The workflow reads the CI run and required jobs from GitHub, reads the evidence comments from issues #34, #36, #40, and #42, and checks that the candidate PR merged this commit to `main`. The evaluation evidence is the initial LangSmith evaluation of synthetic visit-question inputs on #36; the comparative experiment on #41 is deferred to 0.2.0. The issue #42 comment must describe the integrated iOS Simulator scenarios and OS, the actual provider configuration and results or blocker, the test-only fake adapter boundary used by CI, any unverified device limitations, the exact source commit, and the exact successful CI run URL. Include an iOS version, exercised scenarios, the exact CI run link, a `test-only`/`fake` adapter boundary, and the real provider OAuth configuration and result or blocker. Keep provider authentication distinct from the fake-provider Detox run. Record #116 authentic iCloud backup/restore and #117 integrated role-handoff evidence on their owning issue threads with the exact source commit, and link those records from #42. The current v1 readiness schema does not verify #116 or #117, so a release operator must check both independently and keep publication blocked until they are complete. The `simulatorE2E` key name does not waive expanded #42 requirements, and `knownLimitations` must never list a required #42 criterion as an acceptable omission. The approval must be a non-author approval of the final PR head. Only the decision and gate reasons are written to the workflow log; the supplied JSON and evidence comment bodies are not uploaded as artifacts.

## Publish

Use `mode: publish` only after the expanded #42 requirements and integrated iOS Simulator golden path are complete, including #116's authentic iCloud backup and new-device restore and #117's integrated multi-agent flow. Deferred 0.2.0 work does not gate this release. Record actual provider-auth configuration and results separately from the deterministic fake-provider CI suite; if a Simulator route is unavailable, record the observed blocker and provider-access result on #42 and the owning issue. Report other device capabilities as unverified only when they were not exercised; that list does not waive the required #116 transfer. Independently confirm #116 and #117 evidence because the current v1 readiness validator does not cover them. Select `main`, provide the verified version, source SHA, successful CI run ID, and complete readiness JSON. The issue #42 evidence comment must cite that exact source commit and successful CI run. The workflow rechecks all evidence immediately before writing.

If the `v0.1.0` tag is absent, the workflow creates it at the verified source commit using the normal GitHub ref-creation API. It never force-moves a tag. It refuses a tag at another commit and refuses to overwrite an existing GitHub Release. The published release notes include the source SHA, verified CI run, and known limitations. No simulator app, IPA, or unsigned build is attached as a release asset; CI diagnostic artifacts remain separately labeled and expire after 14 days.

## Failure recovery

- A CI or readiness failure makes the publish preflight fail; fix the source or evidence and rerun CI for the exact main SHA before trying again.
- If a tag was created but release creation did not complete, verify that the tag still targets the same SHA, then rerun the publish workflow with the same candidate and evidence. The workflow revalidates the tag and will not move it.
- If a tag targets another SHA or the GitHub Release already exists, the workflow stops without replacing it. Do not force-move the tag or rerun to overwrite the release; have the release owner inspect GitHub and resolve the state through a separately reviewed recovery decision.
- A release job that reaches the final GitHub API call but returns an uncertain result must be read back on GitHub before another attempt. Existing releases are detected and rejected, so retries cannot create duplicate releases or assets.
