import { iosTestInventory } from './ios-test-inventory.mjs';

/** Shared fixture cases keep the requested profile when it owns the full selection. */
export function selectIosTestFixtureProfile(profile, fixtureProfiles, tests) {
  if (
    fixtureProfiles.includes(profile) &&
    tests.every((test) => iosTestInventory(profile).includes(test))
  )
    return profile;
  return fixtureProfiles.find((candidate) =>
    tests.some((test) => iosTestInventory(candidate).includes(test)),
  );
}
