import { iosTestInventory } from '../ios-test-inventory.mjs';
import { productionTestInventory } from '../production-ui-contract.mjs';
import { rotationDiagnosticTests } from '../ios-test-profile-selection.mjs';
import { iosAcceptanceDiagnosticTests } from '../ios-acceptance-diagnostic-inventory.mjs';

/** Include separately selected tests without registering them in default profiles. */
export function explicitIosDiagnosticSelectors() {
  return [
    ...iosTestInventory('speech', 'preparation'),
    ...iosTestInventory('core', 'authentication'),
    ...productionTestInventory,
    ...rotationDiagnosticTests,
    ...iosAcceptanceDiagnosticTests,
  ];
}
