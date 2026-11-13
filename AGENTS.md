# Repository instructions

This file applies to the entire repository and all subdirectories. System, developer, and direct user instructions take precedence over these instructions. More deeply nested `AGENTS.md` files override this file within their subtree. If no stable rule is specific to a subtree, MUST NOT create a separate `AGENTS.md` file.

## Structure and source-of-truth documentation

- The iOS app is in `apps/mobile/`, and shared workspace packages are in `packages/*/`.
- [`README.md`](README.md) is the source of truth for the product overview and user-facing features; [`docs/development.md`](docs/development.md) is the source of truth for the development environment and check procedures (`MUST`).
- [`docs/code-quality.md`](docs/code-quality.md) is the source of truth for quality-check scope and tools; [`docs/releasing.md`](docs/releasing.md) is the source of truth for release verification, and `.github/workflows/release.yml` and the implementations in `scripts/release/` are the source of truth for its actual behavior (`MUST`). Do not copy detailed procedures into this file (`MUST NOT`).

## Naming

- Filenames, code identifiers, test scenarios, accessibility identifiers, and application strings MUST describe their feature, domain, or behavior. They MUST NOT embed issue numbers or use issue-specific prefixes.
- Issue references MUST remain in GitHub metadata or documentation where they provide traceability, rather than becoming implementation names or runtime dependencies.

## Changes and verification

- Before starting work, confirm the current changes and requested scope (MUST). Edit only the files needed within the assigned scope and preserve other contributors' changes (MUST). Do not include unrelated changes (MUST NOT).
- Test selection, required evidence, Simulator preflight and lifecycle, and result reuse MUST follow the canonical [testing policy](TEST.md).
- Verification MUST maximize coverage through unit and integration tests wherever they can faithfully prove the required behavior. UI tests MUST be limited to requirements that can only be faithfully verified through the actual UI or operating-system surface.
- Use [development documentation](docs/development.md) for environment setup, executable check and Simulator procedures, and source line checks. Use [code quality documentation](docs/code-quality.md) for quality-check scope, tools, and formatting follow-up. Use [iOS validation coverage](docs/ios-validation.md) for requirement mappings and revision-scoped evidence. Use [release documentation](docs/releasing.md) for release acceptance.

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
