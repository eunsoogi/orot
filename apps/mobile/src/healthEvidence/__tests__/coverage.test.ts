import { assessHealthEvidenceCoverage } from '../coverage';
import type { HealthEvidenceInventory } from '../coverage';

const completeInventory: HealthEvidenceInventory = {
  inventoryComplete: true,
  availableKinds: ['symptom_entry', 'health_observation'],
  queriedKinds: ['symptom_entry', 'health_observation'],
  unsupportedKinds: [],
  truncatedKinds: [],
};

test('accepts coverage only when every available record kind was queried completely', () => {
  expect(assessHealthEvidenceCoverage(completeInventory)).toEqual({
    status: 'complete',
  });
  expect(
    assessHealthEvidenceCoverage({
      ...completeInventory,
      queriedKinds: ['symptom_entry'],
    }),
  ).toMatchObject({
    status: 'incomplete',
    unqueriedKinds: ['health_observation'],
  });
  expect(
    assessHealthEvidenceCoverage({
      ...completeInventory,
      truncatedKinds: ['health_observation'],
    }),
  ).toMatchObject({
    status: 'incomplete',
    truncatedKinds: ['health_observation'],
  });
});

test('does not claim all-data coverage when the inventory itself is unavailable', () => {
  expect(
    assessHealthEvidenceCoverage({
      ...completeInventory,
      inventoryComplete: false,
    }),
  ).toEqual({
    status: 'unavailable',
  });
});
