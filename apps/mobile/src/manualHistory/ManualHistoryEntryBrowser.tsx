import { useCallback, useState } from 'react';
import {
  Button,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { t } from '../i18n';
import { ManualHistoryEntryCard } from './ManualHistoryEntryCard';
import ManualHistoryEntryDetails from './ManualHistoryEntryDetails';
import {
  MANUAL_HISTORY_DETAILS_MINIMUM_WIDTH,
  MANUAL_HISTORY_LIST_MINIMUM_WIDTH,
  MANUAL_HISTORY_PANEL_GAP,
  manualHistorySupportsColumns,
} from './manualHistoryLayout';
import type { ManualHistoryScreenRecord } from './types';
import type { LayoutChangeEvent } from 'react-native';

interface ManualHistoryEntryBrowserProps {
  readonly entries: readonly ManualHistoryScreenRecord[];
  readonly errorWithoutEntries: boolean;
  readonly history: readonly ManualHistoryScreenRecord[];
  readonly loading: boolean;
  readonly selectedEntry: ManualHistoryScreenRecord | null;
  readonly deleting: boolean;
  readonly onRetry: () => void;
  readonly onOpenDetails: (entry: ManualHistoryScreenRecord) => void;
  readonly onCloseDetails: () => void;
  readonly onCorrect: () => void;
  readonly onDelete: () => void;
}

/** Measures its content lane and keeps the selected history mounted through local reflow. */
export function ManualHistoryEntryBrowser({
  entries,
  errorWithoutEntries,
  history,
  loading,
  selectedEntry,
  deleting,
  onRetry,
  onOpenDetails,
  onCloseDetails,
  onCorrect,
  onDelete,
}: ManualHistoryEntryBrowserProps) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const showColumns =
    selectedEntry !== null &&
    manualHistorySupportsColumns(availableWidth, fontScale);
  const readableScale =
    Number.isFinite(fontScale) && fontScale > 0 ? Math.max(1, fontScale) : 1;

  const measureAvailableWidth = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    // Ignore sub-point layout noise so only real width changes reflow the panels.
    setAvailableWidth(previous =>
      Math.abs(previous - nextWidth) < 0.5 ? previous : nextWidth,
    );
  }, []);

  return (
    <View
      onLayout={measureAvailableWidth}
      style={[
        styles.browser,
        showColumns && styles.columns,
        showColumns && { gap: MANUAL_HISTORY_PANEL_GAP * readableScale },
      ]}
      testID="manual-history-browser"
    >
      <View
        style={[
          styles.listPanel,
          showColumns && styles.listColumn,
          showColumns && {
            minWidth: MANUAL_HISTORY_LIST_MINIMUM_WIDTH * readableScale,
          },
        ]}
        testID="manual-history-list-panel"
      >
        {loading ? (
          <Text testID="manual-history-loading">
            {t('manualHistory.loading')}
          </Text>
        ) : errorWithoutEntries ? (
          <Button
            onPress={onRetry}
            testID="manual-history-retry"
            title={t('manualHistory.retry')}
          />
        ) : entries.length === 0 ? (
          <Text testID="manual-history-empty">{t('manualHistory.empty')}</Text>
        ) : (
          entries.map(entry => (
            <ManualHistoryEntryCard
              key={entry.id}
              entry={entry}
              onOpenDetails={() => onOpenDetails(entry)}
            />
          ))
        )}
      </View>
      {selectedEntry ? (
        <View
          style={[
            styles.selectedPanel,
            showColumns && styles.detailsColumn,
            showColumns && {
              minWidth: MANUAL_HISTORY_DETAILS_MINIMUM_WIDTH * readableScale,
            },
          ]}
          testID="manual-history-selected-panel"
        >
          <ManualHistoryEntryDetails
            entry={selectedEntry}
            history={history}
            onClose={onCloseDetails}
            onCorrect={onCorrect}
            onDelete={onDelete}
            deleting={deleting}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  browser: {
    alignSelf: 'stretch',
    flexDirection: 'column',
    gap: MANUAL_HISTORY_PANEL_GAP,
    minWidth: 0,
  },
  columns: { alignItems: 'flex-start', flexDirection: 'row' },
  listPanel: { gap: MANUAL_HISTORY_PANEL_GAP, minWidth: 0 },
  listColumn: { flex: 0.9 },
  selectedPanel: { minWidth: 0 },
  detailsColumn: { flex: 1.1 },
});
