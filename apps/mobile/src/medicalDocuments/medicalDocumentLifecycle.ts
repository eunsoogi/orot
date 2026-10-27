/** Tracks in-flight originals against the latest local-record lifecycle generation. */
const stagedDocumentGenerations = new Map<string, number>();
const persistedDocumentGenerations = new Map<string, number>();
let lifecycleGeneration = 0;
let localDeletionInProgress = false;

export function currentMedicalDocumentGeneration(): number {
  return lifecycleGeneration;
}

export function getMedicalDocumentGeneration(
  sourceId: string,
): number | undefined {
  return (
    stagedDocumentGenerations.get(sourceId) ??
    persistedDocumentGenerations.get(sourceId)
  );
}

export function canUseMedicalDocumentGeneration(generation: number): boolean {
  return !localDeletionInProgress && generation === lifecycleGeneration;
}

/** Advances before database snapshots so work started on an older epoch cannot persist afterward. */
export function startMedicalDocumentDeletion(): number {
  if (localDeletionInProgress)
    throw new Error('Local deletion is already active.');
  localDeletionInProgress = true;
  lifecycleGeneration += 1;
  for (const sourceId of stagedDocumentGenerations.keys()) {
    stagedDocumentGenerations.set(sourceId, lifecycleGeneration);
  }
  for (const sourceId of persistedDocumentGenerations.keys()) {
    persistedDocumentGenerations.set(sourceId, lifecycleGeneration);
  }
  return lifecycleGeneration;
}

export function endMedicalDocumentDeletion(): void {
  localDeletionInProgress = false;
}

/** Keeps an unsaved picker result protected until it is saved, discarded, or locally deleted. */
export function trackStagedMedicalDocument(sourceId: string): void {
  stagedDocumentGenerations.set(sourceId, lifecycleGeneration);
}

/** Accepts persistence only from the current import epoch. */
export function markMedicalDocumentPersistedInLifecycle(
  sourceId: string,
  generation: number,
): boolean {
  if (!canUseMedicalDocumentGeneration(generation)) return false;
  stagedDocumentGenerations.delete(sourceId);
  persistedDocumentGenerations.set(sourceId, generation);
  return true;
}

export function protectedMedicalDocumentSourceIds(): string[] {
  return [
    ...new Set([
      ...stagedDocumentGenerations.keys(),
      ...persistedDocumentGenerations.keys(),
    ]),
  ];
}

/** Returns null for a database snapshot captured before the current deletion generation. */
export function medicalDocumentReconciliationIds(
  sourceIds: readonly string[],
  generation: number,
): string[] | null {
  if (generation !== lifecycleGeneration) return null;
  return [...new Set([...sourceIds, ...protectedMedicalDocumentSourceIds()])];
}

/** Clears tracking only after native reconciliation confirms the same database generation. */
export function confirmMedicalDocumentReconciliation(
  sourceIds: readonly string[],
  generation: number,
): void {
  if (generation !== lifecycleGeneration) return;
  for (const sourceId of sourceIds) {
    if (stagedDocumentGenerations.get(sourceId) === generation) {
      stagedDocumentGenerations.delete(sourceId);
    }
    if (persistedDocumentGenerations.get(sourceId) === generation) {
      persistedDocumentGenerations.delete(sourceId);
    }
  }
}

/** Retires a complete database-deleted batch before asynchronous native cleanup starts. */
export function retireDeletedMedicalDocumentSources(
  sourceIds: readonly string[],
): void {
  for (const sourceId of sourceIds) {
    stagedDocumentGenerations.delete(sourceId);
    persistedDocumentGenerations.delete(sourceId);
  }
}

export function discardMedicalDocumentFromLifecycle(sourceId: string): void {
  stagedDocumentGenerations.delete(sourceId);
  persistedDocumentGenerations.delete(sourceId);
}
