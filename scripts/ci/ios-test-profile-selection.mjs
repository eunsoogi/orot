import { iosTestInventory } from './ios-test-inventory.mjs';
import { isIosHostPreparation } from './ios-test-preparation-contract.mjs';

const fixtureProfiles = ['fixtures', 'health-import', 'microphone', 'provider-selection'];

/** Resolves the destination, fixture guard, and complete explicit Duo ownership. */
export function resolveIosTestProfileSelection(profile, tests, preparationPhase, rotationControl) {
  const control = 'OrotUITests/TestHostConnectionTests/testSystemBrowserRotationControl';
  if (
    preparationPhase === 'rotation-control' ||
    rotationControl !== undefined ||
    tests.includes(control)
  ) {
    if (
      profile !== 'duo' ||
      preparationPhase !== 'rotation-control' ||
      rotationControl !== 'YES' ||
      tests.length !== 1 ||
      tests[0] !== control
    )
      throw new Error('Rotation control requires its explicit single Duo diagnostic');
    return { fixtureSelection: null, hostPreparation: false, isFixtureProfile: false };
  }
  const hostPreparation = isIosHostPreparation(tests, preparationPhase);
  const isFixtureProfile = fixtureProfiles.includes(profile);
  const profileCandidates = profile === 'duo' ? [...fixtureProfiles, 'duo'] : fixtureProfiles;
  // Host preparation is an explicit exception; otherwise a partial Duo match must fail closed.
  if (
    profile === 'duo' &&
    !hostPreparation &&
    tests.some((test) => !iosTestInventory('duo').includes(test))
  )
    throw new Error('Duo cases require their dedicated host-orchestrated destination');
  const fixtureSelection =
    profileCandidates.includes(profile) &&
    tests.every((test) => iosTestInventory(profile).includes(test))
      ? profile
      : profileCandidates.find((candidate) =>
          tests.some((test) => iosTestInventory(candidate).includes(test)),
        );
  return { fixtureSelection, hostPreparation, isFixtureProfile };
}
