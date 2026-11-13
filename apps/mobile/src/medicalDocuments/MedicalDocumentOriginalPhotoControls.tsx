import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { MedicalDocumentImportError } from './medicalDocumentNativeBridge';

export type PhotoErrorStatus =
  'missing' | 'unavailable' | 'unsupported' | 'corrupt';

/** Provides an explicit retry path for saved originals that cannot be shown. */
export function PhotoError({
  message,
  onRetry,
  testID,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly testID: string;
}) {
  return (
    <View style={styles.error} testID={testID}>
      <Text accessibilityLiveRegion="polite" style={styles.statusText}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={styles.retryButton}
        testID="medical-document-source-original-retry"
      >
        <Text style={styles.retryText}>
          {t('medicalDocument.source.original.retry')}
        </Text>
      </Pressable>
    </View>
  );
}

/** Names zoom actions for assistive technology and reports the current scale. */
export function ZoomButton({
  accessibilityValue,
  disabled,
  label,
  onPress,
  testID,
  visibleLabel,
}: {
  readonly accessibilityValue?: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly visibleLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityValue={
        accessibilityValue ? { text: accessibilityValue } : undefined
      }
      disabled={disabled}
      onPress={onPress}
      style={[styles.zoomButton, disabled && styles.disabled]}
      testID={testID}
    >
      <Text style={styles.zoomButtonText}>{visibleLabel}</Text>
    </Pressable>
  );
}

/** Keeps native file-store failures distinct from an image-decoding failure. */
export function photoErrorState(error: unknown): PhotoErrorStatus {
  if (!(error instanceof MedicalDocumentImportError)) return 'unavailable';
  switch (error.code) {
    case 'ORIGINAL_MISSING':
      return 'missing';
    case 'UNSUPPORTED_ORIGINAL':
      return 'unsupported';
    case 'CORRUPT_ORIGINAL':
      return 'corrupt';
    case 'ORIGINAL_UNAVAILABLE':
    default:
      return 'unavailable';
  }
}

const styles = StyleSheet.create({
  statusText: {
    color: appColors.secondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  error: { alignItems: 'flex-start', gap: 10 },
  retryButton: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  retryText: { color: appColors.primaryText, fontSize: 14, fontWeight: '600' },
  zoomControls: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  zoomButton: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  zoomButtonText: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.55 },
});
