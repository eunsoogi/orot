import { selectIosTestImpact } from './changed-paths-core.mjs';

export function selectE2EPath(path, selection) {
  // Retain the workflow and host checks while selecting complete impact-mapped XCTest cohorts.
  selection.ios_tests = true;
  selection.policy_tests = true;
  // Jest and Metro share these support modules transitively. A filename allowlist misses new consumers.
  selection.unit_tests = true;

  selectIosTestImpact(path, selection);

  // The mobile tsconfig includes every E2E TypeScript file, so Metro-only checks are insufficient.
  if (selection.typescript) selection.typecheck = true;
}
