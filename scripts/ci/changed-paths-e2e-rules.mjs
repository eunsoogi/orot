export function selectE2EPath(path, selection) {
  // Every app test entry feeds the complete iOS replacement gate, including renamed or deleted paths.
  selection.ios_tests = true;
  selection.policy_tests = true;
  // Jest and Metro share these support modules transitively. A filename allowlist misses new consumers.
  selection.unit_tests = true;

  // The mobile tsconfig includes every E2E TypeScript file, so Metro-only checks are insufficient.
  if (selection.typescript) selection.typecheck = true;
}
