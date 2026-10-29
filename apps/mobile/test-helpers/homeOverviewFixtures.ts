import { SymptomEntrySchema } from '@orot/storage';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';
import type { SavedVisitQuestionsLoadState } from '../src/aiFeatures/integration/savedVisitQuestions';

/** Synthetic persisted shapes for Home read-only summaries; no production fixture injection. */
export const activeHomeSymptom = SymptomEntrySchema.parse({
  id: 'home-synthetic-symptom',
  description: '합성 손 저림',
  status: 'active',
  effectiveAt: '2026-10-20T08:00:00Z',
  recordedAt: '2026-10-20T09:00:00Z',
  ingestedAt: '2026-10-20T09:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
});

export function homeJournal(
  entries = [activeHomeSymptom],
): SymptomJournalRepository {
  return {
    list: jest.fn(async filter =>
      entries.filter(
        entry => !filter?.status || entry.status === filter.status,
      ),
    ),
    create: jest.fn(),
    update: jest.fn(),
    resolve: jest.fn(),
  };
}

export function savedHomeQuestions(
  appointmentId: string,
  texts: string[] = [],
): SavedVisitQuestionsLoadState {
  return {
    status: 'ready',
    appointmentId,
    caveats: [],
    restorationNotice: '',
    questions: texts.map((questionText, position) => ({
      questionText,
      position,
      rationale: '합성 질문',
      priority: 'routine',
      citations: [],
    })),
  };
}
