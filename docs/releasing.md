# GitHub source releases

The `Release` workflow publishes a GitHub source release for the version already selected on `main`. It does not build or upload a signed iOS app.

## Dispatch

After the 0.1.0 changes are merged, all 16 protected checks pass on `main`, and the nightly Full E2E succeeds for the exact `main` SHA, the parent maintainer can dispatch **Release** from `main`:

1. Enter the stable version as `MAJOR.MINOR.PATCH`, without a `v` prefix or prerelease suffix. It must match the root `package.json` version and both iOS `MARKETING_VERSION` values. The tag uses that exact input; `0.1.0` creates tag `0.1.0`.
2. Run `dry-run` first. Its summary shows the candidate SHA, current `main` SHA, 16 protected checks, the four trusted workflow runs including the exact-SHA scheduled E2E receipt, the previous reachable version tag, and the complete generated commit-link list. Dry run makes no tag or release changes.
3. Choose `publish` only after reviewing that summary. The write job repeats the version, `main`, CI, tag, and release checks before it writes.

The workflow uses the workflow's own SHA as its candidate; callers do not provide a source SHA, CI run ID, readiness JSON, or approval claim. For each allowlisted quality, unit and policy workflow, it selects the newest `push` or `workflow_dispatch` run for `main` at that exact commit. The E2E workflow runs only on its daily `main` schedule at 03:00 KST. Release accepts only a completed successful scheduled E2E run on the exact candidate SHA; PR, push, manual dispatch, other-branch, other-commit, or focused results do not qualify. If `main` advances during Release verification, rerun Release only after the new SHA receives its own successful nightly E2E. Each quality, unit and policy workflow must pass its mapped protected jobs exactly once. A newer failed or incomplete eligible run cannot be hidden by an older success. Release dispatches run serially. A tag that already points elsewhere is never moved. If the same exact tag and source already have a published, non-prerelease GitHub Release, a repeat dispatch leaves it unchanged; drafts and prereleases fail closed.

## Previous version and commit list

The workflow paginates the repository tag list and considers only stable `MAJOR.MINOR.PATCH` tags, including historical `v`-prefixed tags. Annotated tags are peeled to their commit. The previous entry is the greatest lower version whose commit is an ancestor of the candidate; non-version, newer, and unreachable tags are ignored. If no previous reachable version tag exists, the notes list the candidate's full repository history. Ambiguous reachable tags for one version stop publication.

The release body links each commit to its GitHub commit page. It also records that physical-device and real provider/OAuth results remain unverified. CI simulator or synthetic-provider results are not presented as device or real-provider evidence.

## GitHub source versus iOS distribution

A GitHub Release contains the repository source snapshot, tag, and generated notes. This workflow uploads no IPA and does not make the iOS app installable on an iPhone. Simulator builds, XCTest/XCUITest results and their compatibility status checks do not establish a distribution signature. Synthetic account, Calendar or HealthKit results remain distinct from real account and physical-device validation.

Apple documents TestFlight and App Store distribution through App Store Connect and the Apple Developer Program in its [Xcode distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases) and [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/). The project does not have the paid Apple Developer Program membership or App Store Connect signing/upload setup needed for that route. TestFlight and App Store distribution are deferred to issue #174 for 0.2.0.
