import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';

interface CalendarNavigationLeaveStateInput {
  readonly saving: boolean;
  readonly selectedEventIdentifier: string | null;
  readonly notice: string;
}

/** Treats a calendar candidate as a draft until its explicit save succeeds. */
export function useCalendarNavigationLeaveState({
  saving,
  selectedEventIdentifier,
  notice,
}: CalendarNavigationLeaveStateInput): boolean {
  const [revision, setRevision] = useState(0);
  const hasUnsavedSelection =
    selectedEventIdentifier !== null && notice !== t('calendar.confirmed');

  useEffect(() => {
    setRevision(current => current + 1);
  }, [saving, selectedEventIdentifier, notice]);

  useNavigationLeaveStateRegistration({
    canLeave: !saving,
    hasUnsavedChanges: hasUnsavedSelection,
    isRecording: false,
    hasOngoingOperation: saving,
    revision,
    inputRevision: revision,
  } satisfies NavigationLeaveState);

  return hasUnsavedSelection;
}
