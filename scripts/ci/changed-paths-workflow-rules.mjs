import { basename } from 'node:path';
import { markAllQuality, selectAllIosTestImpact } from './changed-paths-core.mjs';

// Workflow edits can change reusable-call wiring, so keep their dependent leaf checks explicit.
export function selectWorkflowPath(path, selection) {
  selection.policy_tests = true;
  switch (basename(path)) {
    case 'code-quality.yml':
      markAllQuality(selection);
      return true;
    case 'unit-test.yml':
      selection.typecheck = true;
      selection.unit_tests = true;
      return true;
    case 'policy-check.yml':
    case 'release.yml':
    case 'version-pr.yml':
      return true;
    case 'e2e-test.yml':
      selection.ios_build = true;
      selectAllIosTestImpact(selection, 'e2e-workflow-change');
      return true;
    default:
      return false;
  }
}
