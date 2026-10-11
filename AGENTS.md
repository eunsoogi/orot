# Repository instructions

This file applies to the entire repository and all subdirectories. System, developer, and direct user instructions take precedence over these instructions. More deeply nested `AGENTS.md` files override this file within their subtree. If no stable rule is specific to a subtree, MUST NOT create a separate `AGENTS.md` file.

## Structure and source-of-truth documentation

- The iOS app is in `apps/mobile/`, and shared workspace packages are in `packages/*/`.
- [`README.md`](README.md) is the source of truth for the product overview and user-facing features; [`docs/development.md`](docs/development.md) is the source of truth for the development environment and check procedures (`MUST`).
- [`docs/code-quality.md`](docs/code-quality.md) is the source of truth for quality-check scope and tools; [`docs/releasing.md`](docs/releasing.md) is the source of truth for release verification, and `.github/workflows/release.yml` and the implementations in `scripts/release/` are the source of truth for its actual behavior (`MUST`). Do not copy detailed procedures into this file (`MUST NOT`).

## Changes and verification

- Before starting work, confirm the current changes and requested scope (`MUST`). Edit only the files needed within the assigned scope and preserve other contributors' changes (`MUST`). Do not include unrelated changes (`MUST NOT`).
- When changing behavior, add or update tests that demonstrate it and run checks appropriate to the change (`MUST`). From the repository root, use these commands to install development dependencies and run baseline checks (`MUST`):

  ```sh
  pnpm install --frozen-lockfile
  pnpm quality:setup
  pnpm quality:inventory
  pnpm lint
  pnpm format:check
  pnpm typecheck
  pnpm test:unit
  ```

- `pnpm format:write` modifies files included in formatting checks. If you run it, inspect the resulting diff and rerun `pnpm lint` and `pnpm format:check` (`MUST`).
- For changes that require an iOS Simulator build and Detox validation, follow the preparation requirements and commands in [`docs/development.md`](docs/development.md) (`MUST`). For changed-file line-count checks, use the same document's Source line policy (`MUST`).
- Do not arbitrarily narrow the check scope or skip failures (`MUST NOT`). If an exclusion is necessary, use an approved path restriction and state which files were omitted (`MUST`).

## Pull request requirements

- Pull request (PR) titles and bodies MUST be written in English. This requirement applies to PR metadata and MUST NOT change the existing language of Korean product documentation.
- Repository documentation and PR titles and bodies MUST use clear, natural prose, ordinary punctuation, and standard Markdown. They MUST NOT use unnecessary special characters or decorative symbols; meaningful code syntax, identifiers, commands, and URLs MUST be preserved.
- PR titles MUST follow the existing Conventional Commit convention, using `type(scope): description` or `type: description`. The type and description MUST be nonempty; scope is optional.
- An issue-owned PR MUST include an accurate closing reference to its issue, such as `Fixes #<issue-number>`, and MUST use the correct assignee, milestone, and applicable existing `type/*`, `area/*`, and `priority/*` labels.
- After creating or updating an issue-owned PR, MUST use authenticated GitHub readback to verify its title and body, assignee, milestone, applicable labels, linked issue and closing reference, base branch, head branch and commit, and open/draft state before reporting completion or handing it off.
- PRs with incomplete required validation MUST remain drafts. When editing a PR body, preserve the PR's existing metadata and state, and verify them again afterward (`MUST`).

## Code comments

- Authors who write or modify code MUST add or update relevant, useful comments. Comments MUST explain the role and implementation intent of a function or module and, where applicable, non-obvious algorithms, domain constraints, time zones, durations or units, permission, consent or privacy boundaries, failure and recovery handling, and assumptions or limitations of external systems.
- Comments MUST explain reasons, invariants, or boundaries that are not clear from the code. Do not merely repeat the code or leave comments that no longer match the changed behavior (`MUST NOT`).
- Reviewers MUST check that changed code and its related comments agree. Do not put unsupported guarantees, secrets, credentials, or personal health information in comments (`MUST NOT`).
