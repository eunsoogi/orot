import { iosTestInventory } from './ios-test-inventory.mjs';
import { isIosHostPreparation } from './ios-test-preparation-contract.mjs';

const fixtureProfiles = ['fixtures', 'health-import', 'microphone', 'provider-selection'];

/** Resolves the destination, fixture guard, and complete explicit Duo ownership. */
export function resolveIosTestProfileSelection(profile, tests, preparationPhase) {
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
