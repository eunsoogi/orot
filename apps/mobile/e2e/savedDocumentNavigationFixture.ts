import type { RecordRepository } from '@orot/storage';
import type { MedicalDocumentSourceRecord } from '../src/medicalDocuments/medicalDocumentImportService';

const documents: MedicalDocumentSourceRecord[] = Array.from(
  { length: 4 },
  (_, index) => ({
    id: `synthetic-navigation-document-${index}`,
    sourceKind: 'medical_document',
    title: `Synthetic navigation document ${index}`,
    ingestedAt: `2026-11-0${5 - index}T00:00:00Z`,
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  }),
);

/** A selected test entry seeds local records, not files, to isolate UIKit navigation from system-picker readiness. */
export async function prepareSavedDocumentNavigation(
  settings: Record<string, unknown> | undefined,
  repository: () => Promise<RecordRepository>,
): Promise<void> {
  if (
    settings?.OROT_TEST_PROFILE !== 'core' ||
    settings.OROT_E2E_PROBE !== 'medical-document-import' ||
    settings.OROT_TEST_SAVED_DOCUMENT_NAVIGATION !== 'synthetic'
  )
    return;
  const records = await repository();
  // Never overwrite an unexpected record, even in an opted-in synthetic test container.
  for (const document of documents) {
    const existing = await records.get('source_record', document.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(document))
      throw new Error('Reserved synthetic navigation record already exists');
    if (!existing) await records.put('source_record', document);
  }
}
