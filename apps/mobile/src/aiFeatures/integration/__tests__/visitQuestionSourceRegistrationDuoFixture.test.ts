import {
  evidenceSourceDuoFixtureRecords,
  evidenceSourceDuoVisitQuestionCitation,
  seedEvidenceSourceDuoRecords,
} from '../../../../e2e/evidenceSourceDuoProbeFixture';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import type { AiFeatureLocalData } from '../localData';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';

/** Exercises the persisted synthetic source through real citation registration and local reads. */
describe('visit-question saved Duo source fixture', () => {
  it('opens the registered citation from the saved source and excerpt', async () => {
    const { database, close } = createHealthEvidenceTestDatabase();
    try {
      await seedEvidenceSourceDuoRecords(database);
      const data: AiFeatureLocalData = {
        ...createLocalEvidenceData(database),
        repository: createLocalHealthEvidenceRepository(database),
        memoryStorage: { listRecords: async () => [] },
        loadMemoryRecords: async () => [],
        rag: { index: async () => undefined, search: async () => [] },
      };
      const registry = new LocalEvidenceReferenceRegistry();
      const sourceService = createVisitQuestionSourceService(
        registry,
        async () => data,
      );
      const registered = sourceService.registerVisitQuestionSource(
        evidenceSourceDuoVisitQuestionCitation,
        async signal => !signal.aborted,
      );

      await expect(
        registry.readSource(registered, new AbortController().signal),
      ).resolves.toMatchObject({
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: [
            {
              kind: 'source_record',
              record: evidenceSourceDuoFixtureRecords.source,
            },
            {
              kind: 'evidence_span',
              record: evidenceSourceDuoFixtureRecords.excerpt,
            },
          ],
        },
      });
    } finally {
      close();
    }
  });
});
