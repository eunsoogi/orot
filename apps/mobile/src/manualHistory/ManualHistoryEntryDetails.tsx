import { useState } from 'react';
import { View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import {
  manualHistoryEffectiveDateLabel,
  manualHistoryReviewLabel,
} from './manualHistoryLabels';
import type { ManualHistoryScreenRecord } from './types';
import { manualHistoryEntryDetailsStyles as styles } from './manualHistoryEntryDetailsStyles';

interface ManualHistoryEntryDetailsProps {
  entry: ManualHistoryScreenRecord;
  history: readonly ManualHistoryScreenRecord[];
  onCorrect: () => void;
  onClose?: () => void;
  onDelete: () => void | Promise<void>;
  deleting: boolean;
  readingLayout?: boolean;
  provenanceNote?: string;
}

function recordedAtLabel(recordedAt: string): string {
  return t('manualHistory.detail.recordedAt', {
    date: new Date(recordedAt).toLocaleString(),
  });
}

/** Keeps lineage deletion explicit; text identities disambiguate native window ownership without grouping AX content. */
export default function ManualHistoryEntryDetails({
  entry,
  history,
  onCorrect,
  onClose,
  onDelete,
  deleting,
  readingLayout = false,
  provenanceNote,
}: ManualHistoryEntryDetailsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <View
      style={readingLayout ? styles.reading : styles.container}
      testID="manual-history-detail"
    >
      {readingLayout ? (
        <Text
          selectable
          style={styles.readingBody}
          testID="history-memory-body"
        >
          {entry.details}
        </Text>
      ) : (
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('manualHistory.form.detailsLabel')}
        </Text>
      )}
      <View style={readingLayout ? styles.readingFacts : styles.standardFacts}>
        <Text
          style={readingLayout && styles.readingMetadata}
          testID="manual-history-date-detail"
        >
          {manualHistoryEffectiveDateLabel(entry.effectiveDate)}
        </Text>
        {!readingLayout ? <Text>{entry.details}</Text> : null}
        {history.length <= 1 ? (
          <Text
            style={readingLayout && styles.readingMetadata}
            testID="manual-history-current-status"
          >
            {manualHistoryReviewLabel(entry)}
          </Text>
        ) : null}
      </View>
      {readingLayout && provenanceNote ? (
        <Text style={styles.readingMetadata}>{provenanceNote}</Text>
      ) : null}
      {history.length > 1 ? (
        <View style={styles.history} testID="manual-history-correction-history">
          <Text style={styles.sectionTitle}>
            {t('manualHistory.detail.correctionHistory')}
          </Text>
          {history.map((version, index) => (
            <View
              key={version.id}
              style={readingLayout ? styles.readingVersion : styles.version}
              testID={'manual-history-version-' + version.id}
            >
              <Text>
                {index === history.length - 1
                  ? t('manualHistory.detail.currentVersion')
                  : t('manualHistory.detail.earlierVersion')}
              </Text>
              <Text>
                {t(
                  ('manualHistory.kind.' +
                    version.kind) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
                )}
              </Text>
              <Text testID={'manual-history-status-version-' + version.id}>
                {manualHistoryReviewLabel(version)}
              </Text>
              <Text testID="manual-history-recorded-at">
                {recordedAtLabel(version.recordedAt)}
              </Text>
              <Text
                style={styles.entryTitle}
                testID={'manual-history-title-version-' + version.id}
              >
                {version.title}
              </Text>
              <Text testID={'manual-history-date-version-' + version.id}>
                {manualHistoryEffectiveDateLabel(version.effectiveDate)}
              </Text>
              <Text>{version.details}</Text>
              {version.correctionNote ? (
                <Text>
                  {t('manualHistory.detail.correctionNote', {
                    note: version.correctionNote,
                  })}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View
        style={readingLayout ? styles.readingActions : styles.standardActions}
        testID={readingLayout ? 'history-memory-actions' : undefined}
      >
        {/* Keep unrelated controls out of the confirmation and its accessibility order. */}
        {(!readingLayout || !confirmDelete) && (
          <Button
            variant={readingLayout ? 'text' : 'secondary'}
            size={readingLayout ? 'compact' : undefined}
            disabled={deleting}
            onPress={onCorrect}
            testID="manual-history-correct"
            title={t('manualHistory.detail.correct')}
          />
        )}
        {!confirmDelete ? (
          <Button
            variant={readingLayout ? 'destructive' : 'secondary'}
            style={readingLayout ? styles.readingDestructive : undefined}
            size={readingLayout ? 'compact' : undefined}
            disabled={deleting}
            onPress={() => setConfirmDelete(true)}
            testID="manual-history-delete"
            title={t('manualHistory.detail.delete')}
          />
        ) : (
          <View
            style={
              readingLayout ? styles.readingConfirmation : styles.confirmation
            }
            testID="manual-history-delete-confirmation"
          >
            <Text
              accessibilityLiveRegion={readingLayout ? 'polite' : undefined}
              style={readingLayout && styles.confirmationPrompt}
            >
              {t('manualHistory.detail.confirmDelete')}
            </Text>
            <View
              style={
                readingLayout
                  ? styles.readingActions
                  : styles.confirmationActions
              }
            >
              <Button
                variant={readingLayout ? 'destructive' : 'secondary'}
                style={readingLayout ? styles.readingDestructive : undefined}
                size={readingLayout ? 'compact' : undefined}
                disabled={deleting}
                busy={readingLayout && deleting}
                onPress={() => {
                  // The screen owns progress until the deletion settles.
                  onDelete();
                }}
                testID="manual-history-confirm-delete"
                title={t('manualHistory.detail.confirmDeleteAction')}
              />
              <Button
                variant={readingLayout ? 'cancel' : 'secondary'}
                size={readingLayout ? 'compact' : undefined}
                disabled={deleting}
                onPress={() => setConfirmDelete(false)}
                testID="manual-history-cancel-delete"
                title={t('manualHistory.detail.cancelDelete')}
              />
            </View>
          </View>
        )}
        {onClose ? (
          <Button
            variant={readingLayout ? 'text' : 'secondary'}
            size={readingLayout ? 'compact' : undefined}
            disabled={deleting}
            onPress={onClose}
            testID="manual-history-close-details"
            title={t('manualHistory.detail.close')}
          />
        ) : null}
      </View>
    </View>
  );
}
