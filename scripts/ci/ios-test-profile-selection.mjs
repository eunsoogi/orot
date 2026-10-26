import { iosTestInventory } from './ios-test-inventory.mjs';

/** Shared UI identifiers keep the requested destination only when it owns every selected test. */
export function selectIosTestProfileForSelection(profile, profileCandidates, tests) {
  if (
    profileCandidates.includes(profile) &&
    tests.every((test) => iosTestInventory(profile).includes(test))
  )
    return profile;
  return profileCandidates.find((candidate) =>
    tests.some((test) => iosTestInventory(candidate).includes(test)),
  );
}
