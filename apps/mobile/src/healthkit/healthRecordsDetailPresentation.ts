import type { HealthObservation } from '@orot/domain';
import { t } from '../i18n';

/** Uses original quantity data only when storage says that representation is available. */
export function displayedQuantity(
  observation: HealthObservation,
): { readonly amount: number; readonly unit: string } | undefined {
  if (observation.value.kind !== 'quantity') return undefined;
  const original = observation.value.sourceRepresentation;
  return original?.status === 'available'
    ? { amount: original.amount, unit: original.unit }
    : { amount: observation.value.amount, unit: observation.value.unit };
}

/** Provides a readable value without making missing source metadata look complete. */
export function displayRecordValue(observation: HealthObservation): string {
  const quantity = displayedQuantity(observation);
  if (quantity) return quantity.amount + ' ' + quantity.unit;
  switch (observation.value.kind) {
    case 'text':
      return observation.value.text;
    case 'quantity':
      return observation.value.amount + ' ' + observation.value.unit;
    case 'boolean':
      return observation.value.value
        ? t('healthRecords.yes')
        : t('healthRecords.no');
  }
}

export function hasUnavailableSourceValue(
  observation: HealthObservation,
): boolean {
  return (
    observation.value.kind === 'quantity' &&
    observation.value.sourceRepresentation?.status !== 'available'
  );
}

/** Shows only the saved source system and name; external identifiers stay internal. */
export function provenanceLabel(observation: HealthObservation): string {
  const source = observation.provenance.source;
  if (!source) return t('healthRecords.sourceUnavailable');
  const system = source.system === 'healthkit' ? 'HealthKit' : source.system;
  return [system, source.sourceName].filter(Boolean).join(' · ');
}
