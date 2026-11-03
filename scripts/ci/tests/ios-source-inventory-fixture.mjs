import { iosTestCohortTasks, iosTestTaskNeedsUiPreparation } from '../ios-test-cohorts.mjs';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

/** Model an archived case removed from the publisher's inventory. */
export const sourceInventory = {
  names: IOS_TEST_COHORT_NAMES,
  plan: iosTestExecutionPlan,
  tasks: (name) =>
    name === 'core-integration'
      ? [
          ...iosTestCohortTasks(name),
          { profile: 'core', suite: 'legacy', identifiers: ['Legacy/Removed/testCase'] },
        ]
      : iosTestCohortTasks(name),
  cases: iosTestInventory,
  needsUi: iosTestTaskNeedsUiPreparation,
};
