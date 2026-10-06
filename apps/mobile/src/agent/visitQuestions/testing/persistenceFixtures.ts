import type { AgentMemoryService } from '@orot/agent-memory';
import {
  localEvidenceFingerprint,
  visitQuestionCitationKey,
} from '../evidence';
import type { Appointment } from '@orot/domain';
import type { RecordKind, RecordRepository, RecordWriter } from '@orot/storage';
import type { VisitQuestionEvidenceCollection } from '../evidenceCollection';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from '../taskContract';

export const now = '2026-10-07T04:00:00.000Z';

export const appointment: Appointment = {
  id: 'appointment-1',
  effectiveAt: '2026-11-01T09:00:00+09:00',
  recordedAt: '2026-10-01T00:00:00Z',
  ingestedAt: '2026-10-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  calendarEventIdentifier: 'calendar-event-1',
  calendarEventSnapshot: {
    title: 'Synthetic outpatient visit',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: '2026-11-01T00:00:00Z',
    isDetached: false,
    recurrenceRules: [],
  },
};

export const sourceRecord = {
  id: 'source-1',
  effectiveAt: '2026-09-01T09:00:00Z',
  recordedAt: '2026-09-01T09:00:00Z',
  ingestedAt: '2026-09-01T09:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
};

const sourceRecordRevisions = [
  { sourceId: 'source-1', revision: localEvidenceFingerprint(sourceRecord) },
];

export const evidenceSpan = {
  id: 'span-1',
  effectiveAt: '2026-09-01T09:00:00Z',
  recordedAt: '2026-09-01T09:00:00Z',
  ingestedAt: '2026-09-01T09:00:00Z',
  provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
  reviewState: { status: 'unreviewed' },
  sourceRecordId: 'source-1',
  text: 'Synthetic value to discuss',
  locator: { kind: 'text_range', startOffset: 0, endOffset: 26 },
};

export const citation: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: localEvidenceFingerprint(sourceRecordRevisions),
  evidenceId: 'span-1',
  evidenceRevision: localEvidenceFingerprint(evidenceSpan),
  locator: { kind: 'text_range', startOffset: 0, endOffset: 26 },
  effectiveTime: '2026-09-01T09:00:00Z',
  reviewState: 'unreviewed',
  content: 'Synthetic value to discuss',
};

export const candidate: VisitQuestionCandidate = {
  questionText: '이 기록을 진료에서 어떻게 확인하면 좋을까요?',
  rationale: '최근 기록을 의료진과 함께 확인할 수 있어요.',
  priority: 'routine',
  citations: [citation],
};

export function collection(): VisitQuestionEvidenceCollection {
  return {
    batch: { items: [citation], coverage: [], conflicts: [] },
    metadataByCitation: new Map([
      [
        visitQuestionCitationKey(citation),
        {
          sourceRecordIds: ['source-1'],
          sourceRecordRevisions,
          sourceDates: [{ sourceId: 'source-1', date: '2026-09-01T09:00:00Z' }],
          recordKind: 'evidence_span',
          evidenceRecordId: 'span-1',
          evidenceSpanId: 'span-1',
        },
      ],
    ]),
    memoryStatus: 'no_matching_current_memory',
  };
}

export function repository(
  initial: Partial<Record<RecordKind, readonly unknown[]>> = {},
) {
  let tables = new Map<RecordKind, Map<string, unknown>>();
  for (const [kind, records] of Object.entries(initial) as [
    RecordKind,
    readonly unknown[],
  ][]) {
    tables.set(
      kind,
      new Map(records.map(record => [(record as { id: string }).id, record])),
    );
  }
  let transactionCount = 0;

  const service = {
    async transaction<T>(
      operation: (writer: RecordWriter) => Promise<T>,
    ): Promise<T> {
      transactionCount += 1;
      const working = new Map(
        [...tables].map(([kind, records]) => [kind, new Map(records)]),
      );
      const writer = {
        async get(kind: RecordKind, id: string) {
          return (working.get(kind)?.get(id) ?? null) as never;
        },
        async list(kind: RecordKind) {
          return [...(working.get(kind)?.values() ?? [])] as never;
        },
        async put(kind: RecordKind, record: { readonly id: string }) {
          const records = working.get(kind) ?? new Map<string, unknown>();
          records.set(record.id, record);
          working.set(kind, records);
        },
        async delete(kind: RecordKind, id: string) {
          return working.get(kind)?.delete(id) ?? false;
        },
        async putSyncCheckpoint() {},
      } as unknown as RecordWriter;
      const value = await operation(writer);
      tables = working;
      return value;
    },
    async get(kind: RecordKind, id: string) {
      return (tables.get(kind)?.get(id) ?? null) as never;
    },
  } as unknown as RecordRepository;

  return {
    service,
    get transactionCount() {
      return transactionCount;
    },
    list(kind: RecordKind) {
      return [...(tables.get(kind)?.values() ?? [])];
    },
  };
}

export function oldQuestion(id: string, appointmentId?: string) {
  return {
    id,
    effectiveAt: appointment.effectiveAt,
    recordedAt: now,
    ingestedAt: now,
    provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
    reviewState: {
      status: 'reviewed',
      reviewerId: 'local-user',
      reviewedAt: now,
    },
    questionText: '이전 질문을 어떻게 확인할까요?',
    priority: 'routine',
    evidenceSpanIds: [],
    ...(appointmentId
      ? { appointmentId, rationale: '이전 이유', position: 1 }
      : {}),
  };
}

export function input(
  store: ReturnType<typeof repository>,
  options: {
    questions?: readonly VisitQuestionCandidate[];
    currentAppointment?: Appointment;
    memory?: Pick<AgentMemoryService, 'remember'>;
    revalidateEvidence?: (
      citations: readonly VisitQuestionEvidenceItem[],
    ) => Promise<boolean>;
  } = {},
) {
  const data = collection();
  return {
    appointmentId: appointment.id,
    expectedAppointmentRevision: localEvidenceFingerprint(
      options.currentAppointment ?? appointment,
    ),
    questions: options.questions ?? [candidate],
    evidence: {
      ...data,
      metadataByCitation: new Map([
        [
          visitQuestionCitationKey(citation),
          {
            ...data.metadataByCitation.get(visitQuestionCitationKey(citation))!,
          },
        ],
      ]),
    },
    repository: store.service,
    memory: options.memory,
    now,
    revalidateEvidence: options.revalidateEvidence ?? (async () => true),
  };
}
