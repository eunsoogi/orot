import { publicWebSources } from '../externalMedicalEvidence/publicWebSources';
import type { EvidenceReference } from '@orot/agent-runtime';
/** Presentation metadata only. No locator, URL, source ID, or executable alias. */
export type SavedArchivedCitation = Readonly<{
  ordinal: number;
  publicOrdinal?: number;
  kind:
    | 'personal_record'
    | 'reviewed_memory'
    | 'external_medical'
    | 'generated_artifact'
    | 'public_web';
  title?: string;
  date?: string;
  publicationDate?: string;
  retrievedDate?: string;
}>;

const dateOnly = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(value)
    ? value.slice(0, 10)
    : undefined;

export function projectSavedArchivedCitations(
  citations: unknown,
): readonly SavedArchivedCitation[] {
  if (!Array.isArray(citations)) return [];
  return citations.flatMap<SavedArchivedCitation>(
    (candidate: unknown, ordinal) => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      )
        return [];
      const reference = candidate as Record<string, unknown>;
      const sourceKind = reference.sourceKind;
      if (
        sourceKind !== 'external_medical' &&
        sourceKind !== 'personal_record' &&
        sourceKind !== 'reviewed_memory' &&
        sourceKind !== 'generated_artifact'
      )
        return [];
      const locator = reference.locator;
      const metadata =
        locator && typeof locator === 'object' && !Array.isArray(locator)
          ? (locator as Record<string, unknown>)
          : undefined;
      const kind =
        sourceKind === 'external_medical' &&
        metadata?.kind === 'public_web_search'
          ? 'public_web'
          : sourceKind;
      if (kind === 'public_web' && typeof reference.sourceId === 'string') {
        const links = publicWebSources({
          sourceKind: 'external_medical',
          sourceId: reference.sourceId,
          locator: locator as EvidenceReference['locator'],
        });
        if (links)
          return links.map(({ title }, publicOrdinal) => ({
            kind,
            ordinal,
            publicOrdinal,
            title,
          }));
      }
      const title =
        typeof metadata?.title === 'string' && metadata.title.trim()
          ? metadata.title.trim()
          : undefined;
      const date = dateOnly(reference.effectiveTime);
      const publicationDate = dateOnly(metadata?.publicationDate);
      const retrievedDate = dateOnly(metadata?.retrievedAt);
      return {
        ordinal,
        kind,
        ...(title ? { title } : {}),
        ...(date ? { date } : {}),
        ...(publicationDate ? { publicationDate } : {}),
        ...(retrievedDate ? { retrievedDate } : {}),
      };
    },
  );
}
