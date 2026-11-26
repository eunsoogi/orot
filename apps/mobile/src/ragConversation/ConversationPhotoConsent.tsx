import { NavigationModal } from '../navigation/NavigationModal';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
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
  reviewedImageGroup,
  includesPrompt,
  onApprove,
  onCancel,
}: {
  readonly visible: boolean;
  readonly providerName: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  readonly reviewedImageGroup?: readonly string[];
  readonly includesPrompt?: boolean;
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
          {reviewedImageGroup
            ? t('ragConversation.photo.groupConsentTitle', {
                provider: providerName,
              })
            : t('ragConversation.photo.consentTitle', {
                provider: providerName,
              })}
        </AppText>
        <AppText>
          {t('ragConversation.photo.consentDestination', {
            model: modelId,
            recipient,
          })}
        </AppText>
        {reviewedImageGroup ? (
          <>
            <AppText>
              {t(
                includesPrompt
                  ? 'ragConversation.photo.groupConsentPrompt'
                  : 'ragConversation.photo.groupConsentOnly',
                { count: String(reviewedImageGroup.length) },
              )}
            </AppText>
            <View style={styles.actions}>
              {reviewedImageGroup.map((uri, index) => (
                <Image
                  key={index}
                  accessibilityLabel={t('ragConversation.photo.preview')}
                  source={{ uri }}
                  style={styles.reviewImage}
                />
              ))}
            </View>
          </>
        ) : (
          <AppText>
            {t(
              remoteProcessing
                ? 'ragConversation.photo.consentRemote'
                : 'ragConversation.photo.consentLocal',
            )}
          </AppText>
        )}
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
  reviewImage: { width: 112, height: 84, borderRadius: 12 },
});
