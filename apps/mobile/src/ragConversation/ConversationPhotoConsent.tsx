import { NavigationModal } from '../navigation/NavigationModal';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Explicit approval is bound by the caller to one provider, source revision and request. */
export function ConversationPhotoConsent({
  visible,
  providerName,
  modelId,
  recipient,
  remoteProcessing,
  onApprove,
  onCancel,
}: {
  readonly visible: boolean;
  readonly providerName: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <NavigationModal
      visible={visible}
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={onCancel}
      testID="conversation-photo-consent"
    >
      <ScrollView contentContainerStyle={styles.content}>
        <AppText style={styles.title}>
          {t('ragConversation.photo.consentTitle', { provider: providerName })}
        </AppText>
        <AppText>
          {t('ragConversation.photo.consentDestination', {
            model: modelId,
            recipient,
          })}
        </AppText>
        <AppText>
          {t(
            remoteProcessing
              ? 'ragConversation.photo.consentRemote'
              : 'ragConversation.photo.consentLocal',
          )}
        </AppText>
        <View style={styles.actions}>
          <AppButton
            title={t('ragConversation.photo.consentApprove')}
            onPress={onApprove}
          />
          <AppButton
            title={t('ragConversation.photo.consentCancel')}
            variant="cancel"
            onPress={onCancel}
          />
        </View>
      </ScrollView>
    </NavigationModal>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    backgroundColor: appColors.background,
  },
  title: { fontSize: 22, fontWeight: '700', color: appColors.text },
  actions: { gap: 8 },
});
