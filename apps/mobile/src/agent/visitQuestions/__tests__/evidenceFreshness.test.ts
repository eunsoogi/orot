import type { EvidenceChunk } from '@orot/rag';
import type { RecordKind } from '@orot/storage';
import { validateVisitQuestionPresentation } from '../presentation';
import { createVisitQuestionEvidenceRevalidator } from '../evidenceRevalidation';
import type { VisitQuestionEvidenceRepository } from '../evidenceRevalidation';
import {
  appointment,
  candidate,
  collection,
  evidenceSpan,
  now,
  sourceRecord,
} from '../testing/persistenceFixtures';

function chunk(text: string): EvidenceChunk {
  return {
    id: 'chunk-1',
    text,
    metadata: {
      sourceId: 'source-1',
      sourceRecordIds: ['source-1'],
      evidenceId: 'span-1',
      evidenceLocator: { kind: 'text_range', startOffset: 0, endOffset: 8 },
      effectiveTime: '2026-09-01T09:00:00Z',
      recordType: 'evidence_span',
      reviewState: { status: 'unreviewed' },
    },
  };
}

function repositoryFor(currentText: string): VisitQuestionEvidenceRepository {
  return {
    async get(kind: RecordKind, id: string) {
      if (kind === 'source_record' && id === sourceRecord.id)
        return sourceRecord as never;
      if (kind === 'evidence_span' && id === evidenceSpan.id)
        return { ...evidenceSpan, text: currentText } as never;
      return null as never;
    },
  } as unknown as VisitQuestionEvidenceRepository;
}

async function presentAgainstCurrentRecord(currentText: string) {
  const repository = repositoryFor(currentText);
  const revalidate = createVisitQuestionEvidenceRevalidator({
    appointment,
    query: '검사 기록',
    metadataByCitation: collection().metadataByCitation,
    queryService: {
      async queryNextConfirmedCalendarAppointment() {
        return { status: 'available' as const, appointment };
      },
      async searchMemory() {
        return { status: 'available' as const, hits: [], limit: 3 };
      },
    },
    repository,
    buildChunks: async () => [chunk(currentText)],
    currentTime: () => now,
  });

  return validateVisitQuestionPresentation(
    { status: 'suggestions', questions: [candidate] },
    revalidate,
  );
}

describe('visit-question evidence freshness before presentation', () => {
  it('keeps suggestions visible when the cited evidence record is unchanged', async () => {
    const result = await presentAgainstCurrentRecord('검사 메모 Aa');

    expect(result.status).toBe('ready');
  });

  it('requires refresh when changed evidence text collides under the old hash', async () => {
    const result = await presentAgainstCurrentRecord('검사 메모 BB');

    expect(result.status).toBe('refresh_required');
  });
});
