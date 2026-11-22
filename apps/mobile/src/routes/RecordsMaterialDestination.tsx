import { useLayoutEffect, useRef } from 'react';
import { View } from 'react-native';
import { GeneratedReportBrowser } from '../generatedReports/GeneratedReportBrowser';
import { GeneratedReportDetailDestination } from '../generatedReports/GeneratedReportDetailDestination';
import type { GeneratedReportRow } from '../generatedReports/types';
import { SavedMemoryBrowser } from '../memory/SavedMemoryBrowser';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import type { AppRouteContentProps } from './AppProps';
import { useIsFocused } from '@react-navigation/native';

/** Each protected Records destination owns the native stack and its ordinary Back. */
export function RecordsMaterialDestination({
  actions,
  onOpenMemory,
  report,
  openReport,
}: {
  readonly actions: AppRouteContentProps['actions'];
  readonly onOpenMemory?: (id: string) => void;
  readonly report?: GeneratedReportRow;
  readonly openReport?: (row: GeneratedReportRow) => boolean;
}) {
  // Native Back never waits for a read; ownership loss fences it immediately.
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const active = useIsFocused();
  const position = useNavigationRouteScrollPosition();
  const covered = useRef(false);
  const awaitingRestore = useRef(false);
  useLayoutEffect(() => {
    if (!awaitingRestore.current) return;
    if (!active) covered.current = true;
    else if (covered.current) {
      awaitingRestore.current = false;
      covered.current = false;
      position?.restore();
    }
  }, [active, position]);
  if (actions.route.name === 'manual-history')
    return (
      <SavedMemoryBrowser
        active={active}
        ownership={actions.ownership}
        onOpenMemory={onOpenMemory}
      />
    );
  if (actions.route.name === 'generated-report-detail')
    return report ? (
      <GeneratedReportDetailDestination
        row={report}
        active={active}
        ownership={actions.ownership}
      />
    ) : null;
  // Preserve the native list and its scroll range underneath the detail route.
  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      pointerEvents={active ? 'auto' : 'none'}
    >
      <GeneratedReportBrowser
        active={active}
        destination
        ownership={actions.ownership}
        onOpenDestination={
          openReport &&
          (row => {
            position?.preserve();
            awaitingRestore.current = true;
            if (!openReport(row)) awaitingRestore.current = false;
          })
        }
      />
    </View>
  );
}
