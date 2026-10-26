import type { RecordKind } from '@orot/storage';

export interface HealthEvidenceInventory {
  /** True only when a bounded local inventory accounted for every stored record kind. */
  readonly inventoryComplete: boolean;
  readonly availableKinds: readonly RecordKind[];
  readonly queriedKinds: readonly RecordKind[];
  readonly unsupportedKinds: readonly RecordKind[];
  readonly truncatedKinds: readonly RecordKind[];
}

export type HealthEvidenceCoverageAssessment =
  | { readonly status: 'complete' }
  | {
      readonly status: 'incomplete';
      readonly unqueriedKinds: readonly RecordKind[];
      readonly unsupportedKinds: readonly RecordKind[];
      readonly truncatedKinds: readonly RecordKind[];
    }
  | { readonly status: 'unavailable' };

/** Refuses to describe a partial record-kind scan as a search across all app data. */
export function assessHealthEvidenceCoverage(
  inventory: HealthEvidenceInventory,
): HealthEvidenceCoverageAssessment {
  if (!inventory.inventoryComplete) return { status: 'unavailable' };
  const availableKinds = new Set(inventory.availableKinds);
  const queriedKinds = new Set(inventory.queriedKinds);
  const unsupportedKinds = [...new Set(inventory.unsupportedKinds)].filter(
    kind => availableKinds.has(kind),
  );
  const truncatedKinds = [...new Set(inventory.truncatedKinds)].filter(kind =>
    availableKinds.has(kind),
  );
  const unqueriedKinds = [...availableKinds].filter(
    kind => !queriedKinds.has(kind),
  );
  if (
    unsupportedKinds.length ||
    truncatedKinds.length ||
    unqueriedKinds.length
  ) {
    return {
      status: 'incomplete',
      unqueriedKinds,
      unsupportedKinds,
      truncatedKinds,
    };
  }
  return { status: 'complete' };
}
