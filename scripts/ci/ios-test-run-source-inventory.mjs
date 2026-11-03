import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Load the source revision's inventory only after verifying its checkout identity. */
export async function readSourceInventory(root, sourceSha) {
  if (!root) throw new Error('Archived replay requires the source revision checkout');
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== sourceSha)
    throw new Error('Source inventory checkout does not match the archived SHA');
  const load = (name) => import(pathToFileURL(resolve(root, 'scripts/ci', name)).href);
  const [plan, cohorts, inventory] = await Promise.all([
    load('ios-test-execution-plan.mjs'),
    load('ios-test-cohorts.mjs'),
    load('ios-test-inventory.mjs'),
  ]);
  return {
    names: plan.IOS_TEST_COHORT_NAMES,
    plan: plan.iosTestExecutionPlan,
    tasks: cohorts.iosTestCohortTasks,
    needsUi: cohorts.iosTestTaskNeedsUiPreparation,
    cases: inventory.iosTestInventory,
  };
}
