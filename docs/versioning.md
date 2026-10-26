# Version update workflow

The **Version PR** workflow accepts a numeric `major.minor.patch` input when manually dispatched from `main`. It rejects malformed or stale versions and treats the current version as a successful no-op.

The root `package.json` version is authoritative. Its value must match both iOS `MARKETING_VERSION` settings before an update can proceed. The workflow updates the root, mobile app, direct `packages/*` workspace package version fields, and those two iOS marketing fields. It leaves dependency declarations, `pnpm-lock.yaml`, `CURRENT_PROJECT_VERSION`, and unrelated project settings unchanged. The release input uses the same plain numeric format, without a `v` prefix.

Each version has one deterministic branch, `automation/version-<version>`. A matching open draft PR is reused. An existing branch or PR that does not match the expected version, base, title, and marker is reported as a conflict; the workflow does not overwrite it or force-push.

## GitHub Actions permissions and checks

The repository owner must enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. The workflow keeps repository-wide token permissions read-only, grants `contents: write` and `pull-requests: write` only to the PR-creation job, and uses a separate metadata job with `issues: write` and `pull-requests: read`. That job copies the assignee, milestone, and classification labels from issue #171, then reads the PR back to verify its title, English body, issue link, base, head, draft state, assignee, milestone, and labels. It uses the job-scoped `GITHUB_TOKEN`; it does not require a personal access token or another secret.

GitHub places `pull_request` runs caused by a `GITHUB_TOKEN`-created PR in an approval-required state. A user with write access must approve the workflow runs on that PR. The existing `pull_request` workflows then produce the required branch-protection checks. A `workflow_dispatch` run by itself does not satisfy those PR checks.

If PR creation is denied, the job fails with the required setting and permission named. A branch may already have been pushed at that point; a later dispatch will refuse to overwrite it until the matching PR is created or the conflicting branch is resolved.
