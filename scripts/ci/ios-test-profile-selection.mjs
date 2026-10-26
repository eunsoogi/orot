import { iosTestInventory } from './ios-test-inventory.mjs';

/** Shared UI identifiers keep the requested destination only when it owns every selected test. */
export function selectIosTestProfileForSelection(
  profile,
  profileCandidates,
  tests,
  inventory = iosTestInventory,
) {
  if (
    profileCandidates.includes(profile) &&
    tests.every((test) => inventory(profile).includes(test))
  )
    return profile;
  return profileCandidates.find((candidate) =>
    tests.some((test) => inventory(candidate).includes(test)),
  );
}
