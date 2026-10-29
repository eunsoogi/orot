import { StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { ManualHistoryEntryCard } from './ManualHistoryEntryCard';
import ManualHistoryEntryDetails from './ManualHistoryEntryDetails';
import type { ManualHistoryScreenRecord } from './types';

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

/** Expands the selected record inside its card so every width retains one reading order. */
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
  return (
    <View style={styles.browser} testID="manual-history-browser">
      <View style={styles.listPanel} testID="manual-history-list-panel">
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
              expanded={selectedEntry?.id === entry.id}
              disabled={deleting}
              onOpenDetails={() =>
                selectedEntry?.id === entry.id
                  ? onCloseDetails()
                  : onOpenDetails(entry)
              }
            >
              {selectedEntry?.id === entry.id ? (
                <View testID="manual-history-selected-panel">
                  <ManualHistoryEntryDetails
                    key={entry.id}
                    entry={selectedEntry}
                    history={history}
                    onClose={onCloseDetails}
                    onCorrect={onCorrect}
                    onDelete={onDelete}
                    deleting={deleting}
                  />
                </View>
              ) : null}
            </ManualHistoryEntryCard>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  browser: { alignSelf: 'stretch', flexDirection: 'column', minWidth: 0 },
  listPanel: { gap: 16, minWidth: 0 },
});
