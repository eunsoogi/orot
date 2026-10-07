import type { EvidenceReference } from '@orot/agent-runtime';
import { RecordIdSchema } from '@orot/domain';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';

type EvidenceRevalidator = (
  references: readonly EvidenceReference[],
  signal: AbortSignal,
) => Promise<boolean>;

function locatorRecordIds(locator: EvidenceReference['locator']): string[] {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator))
    return [];
  const values = locator as Record<string, unknown>;
  return ['recordId', 'segmentId', 'transcriptId', 'sourceRecordId'].flatMap(
    key => (typeof values[key] === 'string' ? [values[key] as string] : []),
  );
}

function structuredRecordIdentity(reference: EvidenceReference): string | null {
  if (
    !reference.locator ||
    typeof reference.locator !== 'object' ||
    Array.isArray(reference.locator)
  )
    return null;
  const locator = reference.locator as Record<string, unknown>;
  return locator.kind === 'structured_record' &&
    typeof locator.recordId === 'string' &&
    locator.recordId === reference.evidenceId
    ? locator.recordId
    : null;
}

/** Rejects deleted or missing local identities before a resume can restore evidence. */
export function withLocalDeletionAwareRevalidation(
  revalidate: EvidenceRevalidator,
): EvidenceRevalidator {
  return async (references, signal) => {
    const personalRecords = references.filter(
      reference => reference.sourceKind === 'personal_record',
    );
    const reviewedMemories = references.filter(
      reference => reference.sourceKind === 'reviewed_memory',
    );

    if (personalRecords.length > 0) {
      // Loading SQLCipher lazily keeps external-only workflows and Node tests from importing native modules.
      const { openLocalStorage } =
        require('../storage/secureDatabase') as typeof import('../storage/secureDatabase');
      const repository = await openLocalStorage();
      for (const reference of personalRecords) {
        const ids = [
          reference.sourceId,
          reference.evidenceId,
          ...locatorRecordIds(reference.locator),
        ];
        const normalizedIds: string[] = [];
        for (const id of ids) {
          const parsed = RecordIdSchema.safeParse(id);
          if (!parsed.success) return false;
          normalizedIds.push(parsed.data);
        }
        const uniqueIds = [...new Set(normalizedIds)];
        if (
          (await repository.listDeletedSourceReferenceIds(uniqueIds)).length > 0
        )
          return false;
        const sourceId = uniqueIds[0]!;
        const source = await repository.get('source_record', sourceId);
        // Structured evidence uses its persisted row key when provenance names an external sample.
        if (!source) {
          const recordId = structuredRecordIdentity(reference);
          if (!recordId || !(await repository.hasStoredRecordId(recordId)))
            return false;
          continue;
        }
        const liveReferences = new Set(
          await repository.listSourceDeletionReferences(sourceId),
        );
        if (uniqueIds.some(id => !liveReferences.has(id))) return false;
      }
    }

    if (reviewedMemories.length > 0) {
      const { openLocalAgentMemoryDatabase } =
        require('../storage/secureDatabase') as typeof import('../storage/secureDatabase');
      const database = await openLocalAgentMemoryDatabase();
      const removedIds = new Set(
        await new SqlCipherAgentMemoryStorage(database).listRemovedSourceIds(),
      );
      const referencedIds = reviewedMemories.flatMap(reference => [
        reference.sourceId,
        reference.evidenceId,
        ...locatorRecordIds(reference.locator),
      ]);
      if (referencedIds.some(id => removedIds.has(id))) return false;
    }

    // The caller remains responsible for comparing current source and evidence revisions.
    return revalidate(references, signal);
  };
}
