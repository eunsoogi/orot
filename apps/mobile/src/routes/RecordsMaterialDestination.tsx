import { GeneratedReportBrowser } from '../generatedReports/GeneratedReportBrowser';
import { SavedMemoryBrowser } from '../memory/SavedMemoryBrowser';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { AppRouteContentProps } from './AppProps';
import { useIsFocused } from '@react-navigation/native';

/** Native child routes keep the existing protected libraries out of the Records landing. */
export function RecordsMaterialDestination({
  actions,
  onOpenMemory,
}: {
  readonly actions: AppRouteContentProps['actions'];
  readonly onOpenMemory?: (id: string) => void;
}) {
  // Browsing has no unsaved work. Register explicitly so native Back (including
  // its gesture) does not wait for a protected load or need an unguarded pop.
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const active = useIsFocused();
  return actions.route.name === 'manual-history' ? (
    <SavedMemoryBrowser
      active={active}
      ownership={actions.ownership}
      onOpenMemory={onOpenMemory}
    />
  ) : (
    <GeneratedReportBrowser
      active={active}
      destination
      ownership={actions.ownership}
    />
  );
}
