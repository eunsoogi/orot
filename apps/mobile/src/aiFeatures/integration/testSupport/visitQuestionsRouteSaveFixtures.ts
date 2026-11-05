import type { Appointment } from '@orot/domain';
import type { VisitQuestionEvidenceItem } from '../../../agent/visitQuestions/taskContract';

export const appointment = {
  id: 'synthetic-visit-1',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  status: 'scheduled' as const,
  calendarEventIdentifier: 'synthetic-calendar-event',
  calendarEventSnapshot: {
    title: '합성 예약',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
} satisfies Appointment;

export function citation(overrides: Partial<VisitQuestionEvidenceItem> = {}) {
  return {
    sourceKind: 'personal_record' as const,
    sourceId: 'record-source-1',
    sourceRevision: 'record-revision-1',
    evidenceId: 'record-evidence-1',
    evidenceRevision: 'span-revision-1',
    locator: { kind: 'evidence_span' as const, evidenceSpanId: 'span-1' },
    effectiveTime: '2035-05-20T09:00:00.000Z',
    reviewState: 'reviewed' as const,
    content: '검토된 건강 기록',
    ...overrides,
  } satisfies VisitQuestionEvidenceItem;
}

export function savedQuestion(reference: VisitQuestionEvidenceItem) {
  return {
    questionText: '최근 증상 변화를 어떻게 정리할까요?',
    rationale: '검토한 원문 근거를 바탕으로 확인합니다.',
    priority: 'routine' as const,
    citations: [reference],
  };
}

export function sourceAlias(
  original: VisitQuestionEvidenceItem,
): VisitQuestionEvidenceItem {
  // Persisted references resolve through current source handles before revision checks.
  return {
    ...original,
    sourceId: 's1',
    sourceRevision: 'sr1',
    evidenceId: 'e1',
    evidenceRevision: 'er1',
    locator: { kind: 'local-evidence', token: 'e1' },
  } as VisitQuestionEvidenceItem;
}

export function preparedContext(items: readonly VisitQuestionEvidenceItem[]) {
  return {
    status: 'ready',
    appointment,
    evidence: { batch: { items }, metadataByCitation: new Map() },
    searchEvidence: jest.fn(async () => ({ batch: { items } })),
    reloadPersonalEvidence: jest.fn(async () => items[0]),
    saveReviewedQuestions: jest.fn(
      async (
        questions: readonly { readonly identity?: { readonly id: string } }[],
      ) => ({
        questions: questions.map((question, index) => ({
          ...question,
          id: question.identity?.id ?? `synthetic-${index}`,
        })),
        memoryStatus: 'saved',
      }),
    ),
    revalidateEvidence: jest.fn(
      async (_items: readonly VisitQuestionEvidenceItem[]) => true,
    ),
  };
}
