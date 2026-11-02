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

- Before starting work, confirm the current changes and requested scope (`MUST`). Edit only the files needed within the assigned scope and preserve other contributors' changes (`MUST`). Do not include unrelated changes (`MUST NOT`).
- When changing behavior, add or update tests that demonstrate it and run checks appropriate to the changed surface (`MUST`). From the repository root, use these commands to install development dependencies and run applicable baseline checks (`MUST`):

  ```sh
  pnpm install --frozen-lockfile
  pnpm quality:setup
  pnpm quality:inventory
  pnpm lint
  pnpm format:check
  pnpm typecheck
  pnpm test:unit
  ```

- A completed passing check MAY be reused only while its relevant source, dependencies, fixtures, configuration and environment remain unchanged. Rerun checks affected by a changed boundary or prior failure. Reuse MUST NOT narrow a required check's scope, skip a failure, or replace required hosted CI and release verification.
- Unit, component and integration checks MUST be the default for issue-level behavior whenever they can test it faithfully. Pure JavaScript or TypeScript decisions, state transitions, callback wiring, parsing, styling contracts, and app service or storage logic that can be verified below the native UI boundary MUST use proportionate checks and required CI. An iOS app, UI-related filename, issue template, or added native test alone MUST NOT make local Simulator execution necessary.
- An owner MUST NOT create or boot a local Simulator, build a native test product, or run a local native runtime test until the following preflight identifies a concrete unmet acceptance criterion or observed defect. The owner MUST explain why proportionate unit/component checks, static or type checks, build-only checks, and applicable existing runtime evidence cannot prove it, then select the smallest native observation or test that can. A native compile requirement alone MUST NOT justify booting a Simulator. Legitimate native-only needs include actual UIKit or rendered geometry and hit targets, operating-system keyboard, focus or accessibility behavior, native permission or consent surfaces, OS or native lifecycle behavior such as protected Keychain state across an actual app restart or restore, platform adapter or entitlement behavior, and other concrete runtime-only boundaries.
- Existing execution evidence MAY be reused only when its relevant source, dependencies, fixtures, configuration and environment remain applicable. Keep the original result separate from its current applicability. Do not rerun a passing full suite, rebuild an unchanged product, or add a parallel native journey solely to duplicate meaningful coverage. Preserve native assertions, do not substitute mocks for required native outcomes, silently skip applicable failures, or claim deferred integration or release validation has passed.
- During orchestrated local work, the parent MUST allocate Simulator devices and heavy native execution after checking active owners and host load. Workers MUST NOT independently create or boot devices or start heavy native work without that allocation. On an interactive developer machine, use one booted device and one heavy native operation at a time by default; the parent MAY adjust this from observed capacity. These local limits MUST NOT change hosted CI scheduling. Required CI and release gates remain in force regardless of whether local Simulator work is needed.

- `pnpm format:write` modifies files included in formatting checks. If you run it, inspect the resulting diff and rerun `pnpm lint` and `pnpm format:check` (`MUST`).
- For changes that require an iOS Simulator build and Detox validation, follow the preparation requirements and commands in [`docs/development.md`](docs/development.md) (`MUST`). For changed-file line-count checks, use the same document's Source line policy (`MUST`).
- At task completion, an owner MUST shut down and delete Simulators created for the task after preserving required test results, screenshots, logs, and build provenance outside the device.
- Before shutdown or deletion, an owner MUST verify each exact device UDID and its current ownership and active use. A Simulator still used or explicitly reserved by another active task MUST NOT be shut down or deleted. A transfer MUST name a new active owner; possible future reuse does not count as cleanup.
- After cleanup, an owner MUST read the Simulator inventory and confirm that each deleted UDID is absent. For an orchestrated child task, the parent orchestrator MUST perform or verify cleanup as part of accepting and cleaning up the completed child.
- Detailed executable cleanup commands MUST remain in [`docs/development.md`](docs/development.md) and MUST NOT be duplicated here.
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
