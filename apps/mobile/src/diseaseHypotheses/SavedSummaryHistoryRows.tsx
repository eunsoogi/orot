import { View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type { SavedSummaryListItem } from './savedSummaries';

/** Metadata-only legacy rows stay visible, but cannot request their quarantined text. */
export function SavedSummaryHistoryRows({
  rows,
  disabled,
  onRead,
}: {
  rows: readonly SavedSummaryListItem[];
  disabled: boolean;
  onRead: (id: string) => void;
}) {
  return (
    <>
      {rows.map(row => (
        <View key={row.id}>
          <AppButton
            variant="secondary"
            title={`${new Date(row.createdAt).toLocaleString('ko-KR')} · ${row.modelName}`}
            disabled={
              disabled ||
              row.inputLineage === 'unknown' ||
              Boolean(row.unavailableReason)
            }
            onPress={() => {
              onRead(row.id);
            }}
          />
          {row.inputLineage === 'unknown' ? (
            <AppText>{t('summaryHistory.unknownLineage')}</AppText>
          ) : null}
        </View>
      ))}
    </>
  );
}
