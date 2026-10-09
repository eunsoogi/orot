import type { Appointment } from '@orot/domain';
import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../../providers/selection/types';
import { visitQuestionCitationKey } from '../evidence';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import type { VisitQuestionEvidenceCollection } from '../evidenceCollection';
import type { VisitQuestionContextResult } from '../evidenceService';
import type { VisitQuestionEvidenceItem } from '../taskContract';

type ReadyContext = Extract<VisitQuestionContextResult, { status: 'ready' }>;

const appointment: Appointment = {
  id: 'private-appointment-id',
  effectiveAt: '2026-11-01T09:00:00+09:00',
  recordedAt: '2026-10-01T00:00:00Z',
  ingestedAt: '2026-10-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  calendarEventIdentifier: 'private-calendar-id',
  calendarEventSnapshot: {
    title: 'Synthetic outpatient visit',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: '2026-11-01T00:00:00Z',
    isDetached: false,
    recurrenceRules: [],
  },
};

function evidence(suffix: string): VisitQuestionEvidenceItem {
  return {
    sourceKind: 'personal_record',
    sourceId: `private-source-${suffix}`,
    sourceRevision: `source-revision-${suffix}`,
    evidenceId: `private-span-${suffix}`,
    evidenceRevision: `span-revision-${suffix}`,
    locator: { kind: 'structured_record', recordId: `private-span-${suffix}` },
    effectiveTime: '2026-10-01T08:00:00+09:00',
    reviewState: 'reviewed',
    content: `합성 검사 기록 ${suffix}를 진료에서 확인하기로 했어요.`,
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
    memoryStatus: 'available',
  };
}

export function preparedContext(): ReadyContext & {
  readonly initialEvidence: VisitQuestionEvidenceItem;
  readonly supplementalEvidence: VisitQuestionEvidenceItem;
} {
  const initialEvidence = evidence('initial');
  const supplementalEvidence = evidence('supplemental');
  return {
    status: 'ready',
    appointment,
    appointmentRevision: 'appointment-revision',
    appointmentContext: {
      effectiveAt: appointment.effectiveAt,
      timeZoneIdentifier: 'Asia/Seoul',
      title: 'Synthetic outpatient visit',
      reason: '검사 결과 확인',
    },
    query: '최근 합성 검사 결과',
    evidence: collection(initialEvidence),
    initialEvidence,
    supplementalEvidence,
    searchEvidence: jest.fn(async () => collection(supplementalEvidence)),
    revalidateEvidence: jest.fn(async () => true),
  };
}

export function makeProvider(
  outputs: readonly string[],
  onGenerate?: (request: LanguageModelRequest, callIndex: number) => void,
) {
  const requests: LanguageModelRequest[] = [];
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'selected-provider',
    displayName: 'Selected synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate(request) {
      const callIndex = requests.push(request) - 1;
      onGenerate?.(request, callIndex);
      return providerSuccess({
        text: outputs[callIndex] ?? '',
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  return { provider, requests };
}

export function selectedOption(
  provider: LanguageModelProvider,
  privacyBoundary: ProviderSelectionOption['privacyBoundary'] = 'selected-context-remote',
): {
  readonly selection: ProviderSelection;
  readonly option: ProviderSelectionOption;
} {
  const selection = { providerId: provider.id, modelId: 'selected-model' };
  return {
    selection,
    option: {
      provider,
      modelId: selection.modelId,
      displayName: 'Selected synthetic model',
      privacyBoundary,
      availability: { status: 'available' },
    },
  };
}

function reference(item: VisitQuestionEvidenceItem) {
  return {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    evidenceId: item.evidenceId,
    evidenceRevision: item.evidenceRevision,
    locator: item.locator,
    effectiveTime: item.effectiveTime,
    reviewState: item.reviewState,
  };
}

export function successfulOutputs(
  initial: VisitQuestionEvidenceItem,
  supplemental: VisitQuestionEvidenceItem,
): string[] {
  const aliases = createVisitQuestionEvidenceAliases(collection(initial).batch);
  const extraAlias = aliases.aliasBatch(collection(supplemental).batch)
    .items[0]!;
  const citation = reference(extraAlias);
  const questions = [
    '최근 검사 결과는 어떤 의미인가요?',
    '이 결과와 관련해 추가로 살펴볼 점이 있나요?',
    '다음 진료 전까지 기록할 내용이 있을까요?',
  ].map(questionText => ({
    questionText,
    rationale: '현재 기록에 확인할 검사 내용이 있어요.',
    priority: 'routine',
    evidenceIds: [citation.evidenceId],
  }));
  return [
    JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
    JSON.stringify({
      toolId: 'visit-question-personal-record-search',
      sourceKind: 'personal_record',
      input: { query: '최근 검사 결과' },
    }),
    JSON.stringify({
      type: 'result',
      value: { status: 'suggestions', questions },
      citations: [citation],
    }),
  ];
}
