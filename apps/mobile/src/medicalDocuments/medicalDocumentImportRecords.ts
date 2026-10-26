import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import type { StagedMedicalDocument } from './medicalDocumentNativeBridge';

export function makeMedicalDocumentSourceRecord(
  document: StagedMedicalDocument,
  timestamp: string,
): SourceRecord {
  // Import time records provenance and must not be mistaken for a clinical event date.
  return {
    id: document.id,
    ingestedAt: timestamp,
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'medical_document',
    title: document.displayName,
    contentHash: document.contentHash,
  };
}

export function makeMedicalDocumentEvidenceSpans(
  document: StagedMedicalDocument,
  timestamp: string,
): EvidenceSpan[] {
  return document.sections.map(section => ({
    id: section.id,
    ingestedAt: timestamp,
    provenance: { origin: 'imported', sourceRecordIds: [document.id] },
    reviewState: { status: 'unreviewed' },
    sourceRecordId: document.id,
    text: section.text,
    ...(section.pageNumber === undefined
      ? {}
      : { pageNumber: section.pageNumber }),
    locator:
      section.pageNumber === undefined
        ? {
            kind: 'text_range' as const,
            startOffset: section.startOffset,
            endOffset: section.endOffset,
          }
        : {
            kind: 'document_range' as const,
            pageNumber: section.pageNumber,
            startOffset: section.startOffset,
            endOffset: section.endOffset,
          },
  }));
}

export function compareMedicalDocumentEvidenceSpans(
  left: EvidenceSpan,
  right: EvidenceSpan,
): number {
  // Preserve source order for the saved-source view regardless of repository identity order.
  const byPage = (left.pageNumber ?? 0) - (right.pageNumber ?? 0);
  if (byPage !== 0) return byPage;
  const leftOffset =
    left.locator?.kind === 'text_range' ||
    left.locator?.kind === 'document_range'
      ? left.locator.startOffset
      : 0;
  const rightOffset =
    right.locator?.kind === 'text_range' ||
    right.locator?.kind === 'document_range'
      ? right.locator.startOffset
      : 0;
  return leftOffset - rightOffset || left.id.localeCompare(right.id);
}
