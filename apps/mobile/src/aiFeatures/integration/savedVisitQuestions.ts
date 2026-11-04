import { savedVisitQuestionNotice } from './savedVisitQuestionNotice';
import type { EvidenceItem } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import type { LocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import type { AiFeatureLocalData } from './localData';
import { restoreSavedGeneratedSources } from './savedVisitQuestionGeneratedSources';
import { restoreVisitQuestionPeriodForHistory } from './savedVisitQuestionHealthContext';
import { stableJson } from './evidenceUtils';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import {
  hasStaleVisitQuestionEvidence,
  readCurrentTranscriptInvalidations,
} from './transcriptInvalidations';
import { isValidSavedVisitQuestion } from './savedVisitQuestionValidation';
import type { AppointmentQuestionRecord } from './savedVisitQuestionValidation';
import {
  registerSavedCitation,
  SavedVisitQuestionsReadError,
} from './savedVisitQuestionCitation';
export { SavedVisitQuestionsReadError } from './savedVisitQuestionCitation';

import type {
  RestoredSavedVisitQuestions,
  SavedVisitQuestionsLoadState,
} from './savedVisitQuestionTypes';
export type {
  RestoredSavedVisitQuestions,
  RestoredVisitQuestion,
  SavedVisitQuestionsLoadState,
} from './savedVisitQuestionTypes';

/** Restores reviewed questions with source links that are current or explicitly marked changed. */
export async function restoreSavedVisitQuestions(input: {
  readonly appointmentId: string;
  readonly records: RecordRepository;
  readonly sourceReader: LocalHealthEvidenceRepository;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly readHealthContext?: HealthContextReader;
  readonly data?: AiFeatureLocalData;
}): Promise<RestoredSavedVisitQuestions> {
  const appointmentId = input.appointmentId.trim();
  if (!appointmentId)
    throw new SavedVisitQuestionsReadError('invalid_question');

  const rows = await input.records.list('visit_question');
  const scoped = rows.filter(
    row => (row as AppointmentQuestionRecord).appointmentId === appointmentId,
  ) as AppointmentQuestionRecord[];
  const staleBeforeRestore = await readCurrentTranscriptInvalidations(
    input.records,
  );
  if (
    scoped.some(row => hasStaleVisitQuestionEvidence(staleBeforeRestore, row))
  ) {
    throw new SavedVisitQuestionsReadError('stale_artifact');
  }
  if (scoped.some(row => !isValidSavedVisitQuestion(row))) {
    throw new SavedVisitQuestionsReadError('invalid_question');
  }
  const ordered = [...scoped].sort((left, right) => {
    const positionDifference = (left.position ?? 0) - (right.position ?? 0);
    return positionDifference || left.id.localeCompare(right.id);
  });
  // Memory and structured-record rows can retain source IDs without persisting a quote span.
  const hasQuestionWithoutSourceSpan = ordered.some(
    row =>
      row.kind !== 'clarification' &&
      row.evidenceSpanIds.length === 0 &&
      !row.healthContextSources?.length &&
      !row.generatedArtifactSources?.length,
  );
  const citationCache = new Map<string, EvidenceItem>();
  let hasChangedPeriod = false;
  let hasUnknownGeneratedSource = false;
  const questions = await Promise.all(
    ordered.map(async row => {
      if (!isValidSavedVisitQuestion(row)) {
        throw new SavedVisitQuestionsReadError('invalid_question');
      }
      const citations = await Promise.all(
        row.evidenceSpanIds.map(async spanId => {
          const cached = citationCache.get(spanId);
          if (cached) return cached;
          const citation = await registerSavedCitation({
            spanId,
            records: input.records,
            sourceReader: input.sourceReader,
            registry: input.registry,
          });
          citationCache.set(spanId, citation);
          return citation;
        }),
      );
      const periods = await Promise.all(
        (row.healthContextSources ?? []).map(source =>
          restoreVisitQuestionPeriodForHistory(
            source,
            input.readHealthContext,
            input.registry,
          ),
        ),
      );
      if (periods.some(period => period.changed)) hasChangedPeriod = true;
      const generated = await restoreSavedGeneratedSources(
        row.generatedArtifactSources ?? [],
        input.data,
        input.registry,
      );
      hasUnknownGeneratedSource ||= generated.unknown;
      return {
        ...(row.kind ? { kind: row.kind } : {}),
        ...(row.kind !== 'clarification' &&
        citations.length === 0 &&
        periods.length === 0
          ? {
              legacySource: {
                id: row.id,
                revision: localEvidenceFingerprint(row),
              },
            }
          : {}),
        questionText: row.questionText,
        rationale: row.rationale,
        priority: row.priority,
        position: row.position,
        citations: [...citations, ...periods.map(period => period.item)],
        ...(generated.items.length
          ? { generatedArtifactContext: generated.items }
          : {}),
      };
    }),
  );
  const staleAfterRestore = await readCurrentTranscriptInvalidations(
    input.records,
  );
  if (
    ordered.some(row => hasStaleVisitQuestionEvidence(staleAfterRestore, row))
  ) {
    throw new SavedVisitQuestionsReadError('stale_artifact');
  }
  // A deletion/move guard can remove a saved row while its sources are loading.
  // Recheck the artifact itself as well as its source so that async restoration cannot resurrect it.
  const currentRows = await Promise.all(
    ordered.map(row => input.records.get('visit_question', row.id)),
  );
  if (
    ordered.some(
      (row, index) =>
        !currentRows[index] ||
        stableJson(currentRows[index]) !== stableJson(row),
    )
  )
    throw new SavedVisitQuestionsReadError('changed_saved_questions');
  const generatedLinks = questions.flatMap(
    question => question.generatedArtifactContext ?? [],
  );
  if (
    generatedLinks.length &&
    !(await input.registry.revalidateEvidence(
      generatedLinks,
      new AbortController().signal,
    ))
  )
    throw new SavedVisitQuestionsReadError('changed_generated_source');
  const hasGeneratedOnly = questions.some(
    question =>
      question.citations.length === 0 &&
      (question.generatedArtifactContext?.length ?? 0) > 0,
  );

  return {
    appointmentId,
    questions,
    caveats: [],
    // An empty appointment list has no legacy metadata to restore or warn about.
    restorationNotice: savedVisitQuestionNotice({
      empty: questions.length === 0,
      hasChangedPeriod,
      hasUnknownGeneratedSource,
      hasGeneratedOnly,
      onlyClarifications: ordered.every(row => row.kind === 'clarification'),
      hasQuestionWithoutSourceSpan,
      hasPeriod: ordered.some(row => Boolean(row.healthContextSources?.length)),
      hasGeneratedSources: ordered.some(row =>
        Boolean(row.generatedArtifactSources?.length),
      ),
    }),
  };
}

/** Associates every read failure with the appointment whose saved list was requested. */
export async function loadSavedVisitQuestionState(input: {
  readonly appointmentId: string;
  readonly records: RecordRepository;
  readonly sourceReader: LocalHealthEvidenceRepository;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly readHealthContext?: HealthContextReader;
  readonly data?: AiFeatureLocalData;
}): Promise<SavedVisitQuestionsLoadState> {
  const appointmentId = input.appointmentId.trim();
  try {
    return {
      status: 'ready',
      ...(await restoreSavedVisitQuestions({ ...input, appointmentId })),
    };
  } catch (error) {
    const message =
      error instanceof SavedVisitQuestionsReadError &&
      error.reason === 'missing_citation_source'
        ? '질문에 연결된 원문 근거를 찾을 수 없어 저장 목록을 불러오지 못했어요.'
        : error instanceof SavedVisitQuestionsReadError &&
            error.reason === 'changed_generated_source'
          ? '이전 AI 결과가 바뀌었거나 삭제되어 저장된 질문을 불러오지 못했어요. 다시 생성해 주세요.'
          : error instanceof SavedVisitQuestionsReadError &&
              error.reason === 'changed_saved_questions'
            ? '저장된 질문 목록이 바뀌었어요. 다시 불러와 주세요.'
            : error instanceof SavedVisitQuestionsReadError &&
                error.reason === 'changed_health_context'
              ? '건강 기록이 바뀌었거나 근거를 확인할 수 없어 저장된 질문을 불러오지 못했어요. 다시 생성해 주세요.'
              : error instanceof SavedVisitQuestionsReadError &&
                  error.reason === 'stale_artifact'
                ? '녹취 내용이 수정되어 저장된 질문의 원문 근거를 불러오지 못했어요.'
                : error instanceof SavedVisitQuestionsReadError
                  ? '저장된 질문의 정보가 올바르지 않아 불러오지 못했어요.'
                  : '저장된 질문을 불러오지 못했어요. 다시 시도해 주세요.';
    return {
      status: 'error',
      appointmentId,
      questions: [],
      message,
    };
  }
}
