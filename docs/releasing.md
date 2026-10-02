# Orot release process

This repository currently admits `v0.1.0` only. Release automation creates a GitHub Release after validating the exact main commit, its successful main CI run, issue evidence, and a human approval recorded on the candidate pull request. CI simulator builds are test evidence only; this process does not create an installable iPhone IPA or submit to TestFlight or the App Store.

For workstation setup and the pinned development commands, see [Development setup](development.md).

## CI checks

Pull requests targeting `main` and every push to `main` run the same checked-in commands: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm ios:build`, `pnpm e2e:build:ios`, and `pnpm e2e:test:ios`. Dependency installation is frozen. The unit job rejects missing, zero-test, skipped, pending, or todo results. The Detox job builds and launches the app in an iOS Simulator and retains test output, failure screenshots, recordings, and app logs for 14 days.

The iOS jobs use GitHub's `xcode-27` public-preview runner and verify macOS 27.0, Xcode 27.0, iOS Simulator SDK 27.0, Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, and CocoaPods 1.17.0 before building. The workflow installs pinned pnpm before `setup-node` initializes its lockfile-keyed cache. The Detox job installs [AppleSimulatorUtils](https://github.com/wix/AppleSimulatorUtils) 0.9.12 from the Wix Homebrew tap and checks the reported version; Detox requires this utility to control the iOS Simulator. A successful simulator run does not prove physical-device behavior, signing, or distribution readiness. The integrated #42 Detox suite must use deterministic synthetic fixtures and an explicitly test-only fake model/auth adapter, without application or provider credentials. Record that fake boundary in the #42 evidence, separate from the actual provider-auth result. Until #8 implements its Simulator OAuth flow, report that implementation blocker on issue #8; if the flow exists but access or callback handling fails, record the observed blocker there. List physical-device, HealthKit, microphone, speech, and other hardware behavior as unverified limitations; no physical-iPhone run is required for 0.1.0. Do not put credentials or personal health data in test output or artifacts.

## Dry run

Run **Release** from the `main` branch using **Actions → Release → Run workflow**. Keep `mode` at `dry-run`, enter version `0.1.0`, the full main commit SHA, and the run ID of the successful `CI` push run for that exact SHA. Leave readiness evidence empty until the release gates are complete. The workflow reports that publication is blocked and performs no tag or release write when evidence is missing.

The dry run checks workflow ref, source SHA ancestry on `main`, package version, immutable tag state, actual CI run metadata, and all three required CI job results. Both dry-run and publish modes require the `CI / Detox iOS E2E` result; a missing or mismatched AppleSimulatorUtils installation fails that job and keeps release validation blocked. If readiness JSON is supplied, the dry run also validates the evidence and approval without publishing. A mismatched version, failed or skipped CI job, stale tag, or existing release fails closed.

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
    "evaluation": { "url": "https://github.com/eunsoogi/orot/issues/41#issuecomment-<id>" },
    "deletion": { "url": "https://github.com/eunsoogi/orot/issues/34#issuecomment-<id>" },
    "telemetry": { "url": "https://github.com/eunsoogi/orot/issues/40#issuecomment-<id>" }
  },
  "knownLimitations": [
    "Physical-device behavior, including HealthKit, microphone and speech, remains unverified because 0.1.0 validation uses iOS Simulator only.",
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

The workflow reads the CI run and required jobs from GitHub, reads the evidence comments from issues #34, #40, #41, and #42, and checks that the candidate PR merged this commit to `main`. The issue #42 comment must describe the integrated iOS Simulator scenarios and OS, the actual provider configuration and results or blocker, the test-only fake adapter boundary used by CI, unverified hardware limitations, the exact source commit, and the exact successful CI run URL. Include an iOS version, exercised scenarios, the exact CI run link, a `test-only`/`fake` adapter boundary, and the real provider OAuth configuration and result or blocker. Keep provider authentication distinct from the fake-provider Detox run. The approval must be a non-author approval of the final PR head. Only the decision and gate reasons are written to the workflow log; the supplied JSON and evidence comment bodies are not uploaded as artifacts.

## Publish

Use `mode: publish` only after all planned feature waves and the integrated iOS Simulator golden path are complete. Record actual provider-auth configuration and results separately from the deterministic fake-provider CI suite; if Simulator OAuth is unavailable, record the observed blocker on issue #8 and include it in known limitations. Identify physical-device behavior, HealthKit, microphone, speech, and other hardware capabilities as unverified when they were not exercised. No physical-iPhone run is required for 0.1.0. Select `main`, provide the verified version, source SHA, successful CI run ID, and complete readiness JSON. The issue #42 evidence comment must cite that exact source commit and successful CI run. The workflow rechecks all evidence immediately before writing.

If the `v0.1.0` tag is absent, the workflow creates it at the verified source commit using the normal GitHub ref-creation API. It never force-moves a tag. It refuses a tag at another commit and refuses to overwrite an existing GitHub Release. The published release notes include the source SHA, verified CI run, and known limitations. No simulator app, IPA, or unsigned build is attached as a release asset; CI diagnostic artifacts remain separately labeled and expire after 14 days.

## Failure recovery

- A CI or readiness failure makes the publish preflight fail; fix the source or evidence and rerun CI for the exact main SHA before trying again.
- If a tag was created but release creation did not complete, verify that the tag still targets the same SHA, then rerun the publish workflow with the same candidate and evidence. The workflow revalidates the tag and will not move it.
- If a tag targets another SHA or the GitHub Release already exists, the workflow stops without replacing it. Do not force-move the tag or rerun to overwrite the release; have the release owner inspect GitHub and resolve the state through a separately reviewed recovery decision.
- A release job that reaches the final GitHub API call but returns an uncertain result must be read back on GitHub before another attempt. Existing releases are detected and rejected, so retries cannot create duplicate releases or assets.
