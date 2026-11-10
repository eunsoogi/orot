import { useCallback, useEffect, useState } from 'react';
import type { VisitQuestionRecord } from '@orot/domain';
import type { ManualVisitQuestion } from './manualVisitRecordService';

interface ManualVisitDraft {
  readonly questionId: string;
  readonly questionRevision: string;
  readonly answer: string;
  readonly recordId?: string;
  readonly recordRevision?: number;
}

export type ManualVisitDrafts = Map<string, ManualVisitDraft>;

/** Keeps an editor draft in memory while its owning visit panel revalidates. */
export function useManualVisitDraft(
  appointmentId: string,
  drafts?: ManualVisitDrafts,
) {
  const [draft, setDraft] = useState(() => drafts?.get(appointmentId) ?? null);
  useEffect(() => {
    setDraft(drafts?.get(appointmentId) ?? null);
  }, [appointmentId, drafts]);
  const write = useCallback(
    (next: ManualVisitDraft | null) => {
      if (next) drafts?.set(appointmentId, next);
      else drafts?.delete(appointmentId);
      setDraft(next);
    },
    [appointmentId, drafts],
  );
  const clear = useCallback(() => write(null), [write]);
  return {
    draft,
    clear,
    begin(item: ManualVisitQuestion, record?: VisitQuestionRecord) {
      write({
        questionId: item.question.id,
        questionRevision: item.revision,
        answer: record?.answer ?? '',
        recordId: record?.id,
        recordRevision: record?.revision,
      });
    },
    setAnswer(answer: string) {
      if (draft) write({ ...draft, answer });
    },
  };
}

/** A restored editor can only attach to the exact question and record it opened. */
export function matchesManualVisitDraft(
  item: ManualVisitQuestion,
  draft: ManualVisitDraft,
): boolean {
  return (
    item.question.id === draft.questionId &&
    item.revision === draft.questionRevision &&
    (draft.recordId
      ? item.records.some(
          record =>
            record.id === draft.recordId &&
            record.revision === draft.recordRevision,
        )
      : !item.records.some(
          record => record.sourceMethod === 'manual_confirmed',
        ))
  );
}
