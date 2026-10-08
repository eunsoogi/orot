import type { Appointment } from '@orot/domain';
import type { EvidenceReference } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import { visitQuestionCitationKey } from '../src/agent/visitQuestions/evidence';
import type { VisitQuestionEvidenceCollection } from '../src/agent/visitQuestions/evidenceCollection';
import type { VisitQuestionContextResult } from '../src/agent/visitQuestions/evidenceService';
import type { VisitQuestionEvidenceItem } from '../src/agent/visitQuestions/taskContract';

type ReadyContext = Extract<VisitQuestionContextResult, { status: 'ready' }>;

export interface VisitQuestionsProbeMetrics {
  calls: number;
  taskResponses: number;
  allowedReferenceCount: number;
  privateIdentifierExposed: boolean;
}

const appointment: Appointment = {
  id: 'probe-private-appointment',
  effectiveAt: '2035-06-02T09:00:00+09:00',
  recordedAt: '2035-05-01T00:00:00Z',
  ingestedAt: '2035-05-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  calendarEventIdentifier: 'probe-private-calendar-event',
  calendarEventSnapshot: {
    title: '합성 외래 방문',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: '2035-06-02T00:00:00Z',
    isDetached: false,
    recurrenceRules: [],
  },
};

function evidence(suffix: string): VisitQuestionEvidenceItem {
  const evidenceId = 'probe-private-span-' + suffix;
  return {
    sourceKind: 'personal_record',
    sourceId: 'probe-private-source-' + suffix,
    sourceRevision: 'probe-private-source-revision-' + suffix,
    evidenceId,
    evidenceRevision: 'probe-private-span-revision-' + suffix,
    locator: { kind: 'structured_record', recordId: evidenceId },
    effectiveTime: '2035-05-01T09:00:00+09:00',
    reviewState: 'reviewed',
    content: '이 프로브에만 쓰는 합성 검사 기록입니다.',
  };
}

function collection(
  item: VisitQuestionEvidenceItem,
): VisitQuestionEvidenceCollection {
  return {
    batch: {
      items: [item],
      coverage: [
        {
          sourceKind: item.sourceKind,
          searchedSourceIds: [item.sourceId],
          gaps: [],
          truncated: false,
          resultLimit: 5,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    metadataByCitation: new Map([
      [
        visitQuestionCitationKey(item),
        {
          sourceRecordIds: [item.sourceId],
          sourceRecordRevisions: [],
          sourceDates: [],
        },
      ],
    ]),
    memoryStatus: 'no_matching_current_memory',
  };
}

export function createPreparedContext(): ReadyContext {
  const initial = evidence('initial');
  const supplemental = evidence('supplemental');
  return {
    status: 'ready',
    appointment,
    appointmentRevision: 'probe-appointment-revision',
    appointmentContext: {
      effectiveAt: appointment.effectiveAt,
      timeZoneIdentifier: 'Asia/Seoul',
      title: '합성 외래 방문',
      reason: '합성 검사 결과 확인',
    },
    query: '합성 검사 결과',
    evidence: collection(initial),
    searchEvidence: async () => collection(supplemental),
    revalidateEvidence: async () => true,
  };
}

function requestText(request: LanguageModelRequest): string {
  return request.messages
    .map(message =>
      message.role !== 'tool' && typeof message.content === 'string'
        ? message.content
        : '',
    )
    .join('\n');
}

function citationReferences(
  request: LanguageModelRequest,
): EvidenceReference[] {
  const marker = 'Allowed citation references (cite exact objects only):\n';
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (
      message?.role !== 'tool' &&
      typeof message?.content === 'string' &&
      message.content.startsWith(marker)
    ) {
      return JSON.parse(
        message.content.slice(marker.length),
      ) as EvidenceReference[];
    }
  }
  throw new Error('The synthetic request did not include citation references.');
}

// The fake provider receives only opaque aliases while the real workflow performs each role handoff.
export function createSyntheticProvider(
  metrics: VisitQuestionsProbeMetrics,
): LanguageModelProvider {
  return {
    kind: 'language-model',
    id: 'visit-question-synthetic-provider',
    displayName: 'Visit question synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate(request) {
      metrics.calls += 1;
      metrics.privateIdentifierExposed ||=
        JSON.stringify(request).includes('probe-private-');
      const text = requestText(request);
      if (text.includes('Role: EvidenceResearcher')) {
        return providerSuccess({
          text: JSON.stringify({
            toolId: 'visit-question-personal-record-search',
            sourceKind: 'personal_record',
            input: { query: '합성 검사 결과' },
          }),
          toolCalls: [],
          finishReason: 'complete',
        });
      }
      if (metrics.taskResponses++ === 0) {
        return providerSuccess({
          text: JSON.stringify({
            type: 'request_evidence',
            need: 'missing_coverage',
          }),
          toolCalls: [],
          finishReason: 'complete',
        });
      }

      const references = citationReferences(request);
      const citation = references[references.length - 1];
      if (!citation)
        throw new Error('No synthetic evidence reference was available.');
      metrics.allowedReferenceCount = references.length;
      const questions = [
        '최근 검사 결과를 어떻게 해석하면 될까요?',
        '이 결과와 관련해 추가로 확인할 검사가 있을까요?',
        '진료 전에 기록해 두면 좋을 증상이 있을까요?',
      ].map((questionText, index) => ({
        questionText,
        rationale:
          '현재 근거에 합성 검사 기록이 있어 진료에서 확인할 수 있어요.',
        priority: index === 0 ? 'important' : 'routine',
        evidenceIds: [citation.evidenceId],
      }));
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { status: 'suggestions', questions },
          citations: [citation],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
}

export function createVisitQuestionsProbeMetrics(): VisitQuestionsProbeMetrics {
  return {
    calls: 0,
    taskResponses: 0,
    allowedReferenceCount: 0,
    privateIdentifierExposed: false,
  };
}
