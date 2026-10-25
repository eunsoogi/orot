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
}

export default function ProviderSelectionConfirmation({
  option,
  blockedMessage,
  canConfirm,
  saving,
  onConfirm,
  onCancel,
}: ProviderSelectionConfirmationProps) {
  const local = option.privacyBoundary === 'on-device';
  return (
    <View style={styles.container} testID="provider-selection-confirmation">
      {blockedMessage ? (
        <Text accessibilityRole="alert" style={styles.blockedMessage}>
          {blockedMessage}
        </Text>
      ) : null}
      <View style={styles.privacy}>
        <AppSymbol name="checkmark.shield.fill" size={24} />
        <Text
          style={styles.privacyCopy}
          testID="provider-selection-confirmation-privacy"
        >
          {local
            ? providerSelectionText.onDevicePrivacy
            : providerSelectionText.remotePrivacy}
        </Text>
      </View>
      <Pressable
        style={styles.summary}
        accessibilityRole="button"
        accessibilityLabel={`${option.displayName}, ${providerSelectionText.cancel}`}
        disabled={saving}
        onPress={onCancel}
        testID="provider-selection-cancel"
      >
        <Text style={styles.summaryText}>
          선택한 AI · <Text style={styles.name}>{option.displayName}</Text>
        </Text>
      </Pressable>
      <Button
        disabled={saving || !canConfirm}
        onPress={onConfirm}
        testID="provider-selection-confirm"
        title="이 AI 사용"
      />
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
  summary: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  summaryText: { fontSize: 16, fontWeight: '600', color: appColors.text },
  name: { color: appColors.primaryText },
  blockedMessage: { color: appColors.danger },
});
