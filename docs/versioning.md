# Version update workflow

The **Version PR** workflow accepts a numeric `major.minor.patch` input when manually dispatched from `main`. It rejects malformed or stale versions and treats the current version as a successful no-op.

The root `package.json` version is authoritative. Its value must match both iOS `MARKETING_VERSION` settings before an update can proceed. The workflow updates the root, mobile app, direct `packages/*` workspace package version fields, and those two iOS marketing fields. It leaves dependency declarations, `pnpm-lock.yaml`, `CURRENT_PROJECT_VERSION`, and unrelated project settings unchanged. The release input uses the same plain numeric format, without a `v` prefix.

Each version has one deterministic branch, `automation/version-<version>`. The title and body name the requested version, and an exact version marker identifies its body. A matching open draft PR is reused; additional maintainer prose is preserved. The generated body has no fixed issue closing reference. An existing branch or PR that does not match the expected version, base, title, and marker is reported as a conflict; the workflow does not overwrite it or force-push.

## GitHub Actions permissions and checks

The repository owner must enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. The workflow keeps repository-wide token permissions read-only, grants `contents: write` and `pull-requests: write` only to the PR-creation job, and uses a separate metadata job with `issues: write` and `pull-requests: read`. Version automation explicitly requires assignee `eunsoogi` and labels `area/foundation`, `type/ci`, and `priority/p1` as repository policy, independently of any release issue. The metadata job adds those fields while preserving the labels and assignees it reads from the PR, then reads the PR back to verify its title, version-specific English body and marker, base, head, open draft state, assignee, and labels. It never assigns or updates a milestone: newly generated PRs start without one, maintainers assign it manually, and reuse/readback accepts and preserves that manual choice. It uses the job-scoped `GITHUB_TOKEN`; it does not require a personal access token or another secret.

GitHub places `pull_request` runs caused by a `GITHUB_TOKEN`-created PR in an approval-required state. A user with write access must approve the workflow runs on that PR. The existing `pull_request` workflows then produce the required branch-protection checks. A `workflow_dispatch` run by itself does not satisfy those PR checks.

If PR creation is denied, the job fails with the required setting and permission named. A branch may already have been pushed at that point; a later dispatch will refuse to overwrite it until the matching PR is created or the conflicting branch is resolved.

## Verification and integration boundary

Run `node --test scripts/version/tests/*.test.mjs` and the baseline checks in [development.md](development.md). Local CLI fixtures cover two distinct version inputs, creation, reuse, metadata updates, reruns with or without a manual milestone, and failed readback. They do not prove a live GitHub dispatch or release.

For the 0.3.0 update, dispatch this workflow from `main` only after the prerequisite device-feedback implementation and reusable CI change are integrated. Verify the terminal workflow result, generated draft PR metadata, and version-only diff before manually assigning its milestone. A generated PR does not establish merge, installation, or release; release verification remains in [releasing.md](releasing.md).
