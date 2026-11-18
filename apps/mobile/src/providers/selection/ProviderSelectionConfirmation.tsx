import { t } from '../../i18n';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { AppText as Text } from '../../layout/AppText';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../../layout/AppButton';
import { appColors } from '../../layout/appColors';
import { AppSymbol } from '../../layout/AppSymbol';
import { providerSelectionText } from './text';
import type { ProviderSelectionOption } from './types';

interface ProviderSelectionConfirmationProps {
  readonly option: ProviderSelectionOption;
  readonly blockedMessage: string | null;
  readonly canConfirm: boolean;
  readonly saving: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly hasActionDock?: boolean;
}

export default function ProviderSelectionConfirmation({
  option,
  blockedMessage,
  canConfirm,
  saving,
  onConfirm,
  onCancel,
  hasActionDock = false,
}: ProviderSelectionConfirmationProps) {
  const local = option.privacyBoundary === 'on-device';
  const summary = (
    <Text style={styles.summaryText}>
      {t('modelSettings.selectedAiPrefix')}{' '}
      <Text style={styles.name}>{option.displayName}</Text>
    </Text>
  );
  return (
    <View style={styles.container} testID="provider-selection-confirmation">
      {blockedMessage ? (
        <Text accessibilityRole="alert" style={styles.blockedMessage}>
          {blockedMessage}
        </Text>
      ) : null}
      <View style={styles.privacy}>
        <AppSymbol name="checkmark.shield.fill" />
        <Text
          style={styles.privacyCopy}
          testID="provider-selection-confirmation-privacy"
        >
          {local
            ? providerSelectionText.onDevicePrivacy
            : option.provider.id === APPLE_PCC_PROVIDER_ID
              ? t('provider.pcc.privacy')
              : providerSelectionText.remotePrivacy}
        </Text>
      </View>
      {option.provider.id === 'openai-api-decisions' ? (
        <Text style={styles.usageCost}>{t('modelSettings.apiUsageCost')}</Text>
      ) : null}
      {hasActionDock ? (
        <View style={styles.summary}>{summary}</View>
      ) : (
        <Pressable
          style={styles.summary}
          accessibilityRole="button"
          accessibilityLabel={`${option.displayName}, ${providerSelectionText.cancel}`}
          disabled={saving}
          onPress={onCancel}
          testID="provider-selection-cancel"
        >
          {summary}
        </Pressable>
      )}
      {!hasActionDock ? (
        <Button
          disabled={saving || !canConfirm}
          onPress={onConfirm}
          testID="provider-selection-confirm"
          title={t('modelSettings.confirmLanguage')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  privacy: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingBottom: 8,
  },
  privacyCopy: { flex: 1, color: appColors.secondary, fontSize: 14 },
  usageCost: { color: appColors.secondary, fontSize: 14 },
  // Fill groups identity; privacy copy and explicit confirmation remain outside this decoration.
  summary: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 0,
    backgroundColor: appColors.surface,
  },
  summaryText: { fontSize: 16, fontWeight: '600', color: appColors.text },
  name: { color: appColors.primaryText },
  blockedMessage: { color: appColors.danger },
});
