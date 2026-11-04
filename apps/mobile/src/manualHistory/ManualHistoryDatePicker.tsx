import { requireNativeComponent, StyleSheet } from 'react-native';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

type DateSheetResult = { date?: string; error?: string };
interface DateSheetAnchorProps extends ViewProps {
  readonly request: { id: number; date: string };
  readonly onResult: (event: NativeSyntheticEvent<DateSheetResult>) => void;
}

const NativeDateSheetAnchor = requireNativeComponent<DateSheetAnchorProps>(
  'ManualHistoryDateSheetAnchor',
);

/** The mounted anchor identifies the window that owns each native sheet request. */
export function ManualHistoryDatePicker({
  request,
  onResult,
}: {
  readonly request: { id: number; date: string };
  readonly onResult: (result: DateSheetResult) => void;
}) {
  return (
    <NativeDateSheetAnchor
      pointerEvents="none"
      accessibilityElementsHidden
      style={StyleSheet.absoluteFill}
      request={request}
      onResult={event => onResult(event.nativeEvent)}
      testID="manual-history-date-sheet-anchor"
    />
  );
}
