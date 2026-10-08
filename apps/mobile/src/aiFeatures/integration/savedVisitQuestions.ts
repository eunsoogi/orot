import type { EvidenceItem } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import type { LocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
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

export interface RestoredVisitQuestion {
  readonly questionText: string;
  readonly rationale: string;
  readonly priority: 'routine' | 'important';
  readonly position: number;
  readonly citations: readonly EvidenceItem[];
}

export interface RestoredSavedVisitQuestions {
  readonly appointmentId: string;
  readonly questions: readonly RestoredVisitQuestion[];
  readonly caveats: readonly [];
  /** These values are not in the persisted question/span schema and cannot be reconstructed on reload. */
  readonly restorationNotice: string;
}

export type SavedVisitQuestionsLoadState =
  | ({ readonly status: 'ready' } & RestoredSavedVisitQuestions)
  | {
      readonly status: 'error';
      readonly appointmentId: string;
      readonly questions: readonly [];
      readonly message: string;
    };

/** Restores one appointment's persisted questions and registers current, revalidated source links. */
export async function restoreSavedVisitQuestions(input: {
  readonly appointmentId: string;
  readonly records: RecordRepository;
  readonly sourceReader: LocalHealthEvidenceRepository;
  readonly registry: LocalEvidenceReferenceRegistry;
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
  const citationCache = new Map<string, EvidenceItem>();
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
      return {
        questionText: row.questionText,
        rationale: row.rationale,
        priority: row.priority,
        position: row.position,
        citations,
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

  return {
    appointmentId,
    questions,
    caveats: [],
    restorationNotice:
      '저장된 질문에는 생성 당시의 추가 경고와 원본 버전이 보관되지 않아 복원하지 못했습니다. 표시된 원문 근거를 다시 확인해 주세요.',
  };
}

/** Associates every read failure with the appointment whose saved list was requested. */
export async function loadSavedVisitQuestionState(input: {
  readonly appointmentId: string;
  readonly records: RecordRepository;
  readonly sourceReader: LocalHealthEvidenceRepository;
  readonly registry: LocalEvidenceReferenceRegistry;
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
