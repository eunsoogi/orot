import { AppText as Text } from '../../layout/AppText';
import { StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../../layout/AppButton';
import { appColors } from '../../layout/appColors';
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
      <Text accessibilityRole="header">{option.displayName}</Text>
      {blockedMessage ? (
        <Text accessibilityRole="alert" style={styles.blockedMessage}>
          {blockedMessage}
        </Text>
      ) : null}
      <Text testID="provider-selection-confirmation-privacy">
        {local
          ? providerSelectionText.onDevicePrivacy
          : providerSelectionText.remotePrivacy}
      </Text>
      <Button
        disabled={saving || !canConfirm}
        onPress={onConfirm}
        testID="provider-selection-confirm"
        title={
          local
            ? providerSelectionText.confirmApple
            : providerSelectionText.confirmRemote
        }
      />
      <Button
        disabled={saving}
        onPress={onCancel}
        testID="provider-selection-cancel"
        title={providerSelectionText.cancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, paddingTop: 8 },
  blockedMessage: { color: appColors.danger },
});
