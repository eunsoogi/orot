import { useCallback, useState } from 'react';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type {
  ManualHistoryScreenFormDraft,
  ManualHistoryScreenRecord,
} from './types';

function differsFromSavedEntry(
  draft: ManualHistoryScreenFormDraft,
  entry: ManualHistoryScreenRecord | null,
): boolean {
  const initialKind = entry?.kind ?? 'diagnosis_history';
  const initialTitle = entry?.title ?? '';
  const initialDetails = entry?.details ?? '';
  const initialDateUnknown = entry?.effectiveDate.status === 'unknown';
  const initialDate =
    entry?.effectiveDate.status === 'known' ? entry.effectiveDate.date : '';

  return (
    draft.kind !== initialKind ||
    draft.title !== initialTitle ||
    draft.details !== initialDetails ||
    draft.effectiveDateText !== initialDate ||
    draft.dateUnknown !== initialDateUnknown ||
    draft.correctionNote !== ''
  );
}

/** Keeps per-form drafts and registers them with route navigation's leave guard. */
export function useManualHistoryDraftState(saving: boolean) {
  const [drafts, setDrafts] = useState<
    Readonly<Record<string, ManualHistoryScreenFormDraft | undefined>>
  >({});
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [inputRevision, setInputRevision] = useState(0);

  useNavigationLeaveStateRegistration({
    canLeave: !saving,
    hasUnsavedChanges: dirtyKeys.size > 0,
    isRecording: false,
    hasOngoingOperation: saving,
    revision: inputRevision + Number(saving),
    inputRevision,
  });

  const recordDraft = useCallback(
    (
      key: string,
      draft: ManualHistoryScreenFormDraft,
      savedEntry: ManualHistoryScreenRecord | null,
    ) => {
      setDrafts(current => ({ ...current, [key]: draft }));
      setDirtyKeys(current => {
        const next = new Set(current);
        if (differsFromSavedEntry(draft, savedEntry)) next.add(key);
        else next.delete(key);
        return next;
      });
      setInputRevision(current => current + 1);
    },
    [],
  );

  const clearDraft = useCallback((key: string) => {
    setDrafts(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDirtyKeys(current => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  return { clearDraft, getDraft: (key: string) => drafts[key], recordDraft };
}
