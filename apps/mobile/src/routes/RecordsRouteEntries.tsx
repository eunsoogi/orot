import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';

interface RecordsRouteEntriesProps {
  readonly onOpenSymptoms: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory: () => void;
}

/** Keeps every current Records destination, with recording as the sole primary action. */
export function RecordsRouteEntries({
  onOpenSymptoms,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  onOpenManualHistory,
}: RecordsRouteEntriesProps) {
  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="records-title"
      >
        {t('records.title')}
      </Text>
      <Text style={styles.subtitle}>{t('records.subtitle')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenRecording}
        style={styles.recordingAction}
        testID="records-new-recording"
      >
        <View style={styles.recordingIcon}>
          <AppSymbol
            name="mic.fill"
            size={30}
            color={appColors.primaryAction}
          />
        </View>
        <Text style={styles.recordingActionTitle}>
          {t('records.newRecording')}
        </Text>
      </Pressable>

      {/* Self-reported symptoms stay separate from imported clinical records. */}
      <Pressable
        accessibilityRole="button"
        onPress={onOpenSymptoms}
        style={styles.healthCard}
        testID="symptoms-open"
      >
        <View style={styles.healthIcon}>
          <AppSymbol
            name="square.and.pencil"
            size={28}
            color={appColors.primaryText}
          />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('symptoms.title')}</Text>
          <Text style={styles.cardSummary}>{t('symptoms.description')}</Text>
        </View>
        <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onOpenSavedRecordings}
        style={styles.healthCard}
        testID="records-open-saved-recordings"
      >
        <View style={styles.healthIcon}>
          <AppSymbol name="doc.text" size={28} color={appColors.primaryText} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('recording.library.title')}</Text>
          <Text style={styles.cardSummary}>
            {t('records.savedRecordingsSummary')}
          </Text>
        </View>
        <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onOpenManualHistory}
        style={styles.healthCard}
        testID="records-open-manual-history"
      >
        <View
          style={[
            styles.healthIcon,
            { backgroundColor: appColors.primarySoft },
          ]}
        >
          <AppSymbol
            name="text.book.closed"
            size={28}
            color={appColors.primaryAction}
          />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('manualHistory.title')}</Text>
          <Text style={styles.cardSummary}>{t('manualHistory.subtitle')}</Text>
        </View>
        <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onOpenHealthLibrary}
        style={styles.healthCard}
        testID="records-open-health-library"
      >
        <View
          style={[styles.healthIcon, { backgroundColor: appColors.greenSoft }]}
        >
          <AppSymbol name="folder" size={28} color={appColors.green} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('records.healthRecords')}</Text>
          <Text style={styles.cardSummary}>
            {t('healthRecords.description')}
          </Text>
        </View>
        <Text style={styles.chevron} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    minWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  recordingAction: {
    alignItems: 'center',
    backgroundColor: appColors.primaryAction,
    borderRadius: 22,
    justifyContent: 'center',
    gap: 12,
    minHeight: 108,
    marginTop: 4,
  },
  recordingIcon: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  recordingActionTitle: {
    color: appColors.onPrimary,
    fontSize: 21,
    fontWeight: '700',
  },
  healthCard: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    minHeight: 88,
    paddingHorizontal: 18,
  },
  healthIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  cardCopy: { flex: 1, gap: 4 },
  cardTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  cardSummary: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  chevron: { color: appColors.secondary, fontSize: 24 },
});
