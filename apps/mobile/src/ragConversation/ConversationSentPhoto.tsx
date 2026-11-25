import { useState } from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { ConversationPhotoViewer } from './ConversationPhotoViewer';
import { styles as screen } from './ConversationScreen.styles';

/** Use only an owned mounted JPEG; restored marker-only rows have no pixels. */
export function ConversationSentPhoto({
  previewURI,
}: {
  readonly previewURI?: string;
}) {
  const uri = previewURI?.startsWith('data:image/jpeg;base64,')
    ? previewURI
    : undefined;
  if (!uri)
    return (
      <AppText style={[screen.messageText, screen.userText]}>
        {t('ragConversation.photo.message')}
      </AppText>
    );
  return <OwnedSentPhoto uri={uri} />;
}

function OwnedSentPhoto({ uri }: { readonly uri: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ragConversation.photo.openFullScreen')}
        onPress={() => setOpened(true)}
        testID="conversation-sent-photo-open"
      >
        <Image
          accessibilityRole="image"
          accessibilityLabel={t('ragConversation.photo.preview')}
          source={{ uri }}
          style={styles.thumbnail}
          resizeMode="cover"
          testID="conversation-sent-photo-image"
        />
      </Pressable>
      {opened ? (
        <ConversationPhotoViewer
          photoURI={uri}
          onClose={() => setOpened(false)}
        />
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  thumbnail: { width: 180, height: 140, borderRadius: 12 },
});
