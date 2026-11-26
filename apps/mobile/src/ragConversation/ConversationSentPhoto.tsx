import { useState } from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { ConversationPhotoViewer } from './ConversationPhotoViewer';
import { styles as screen } from './ConversationScreen.styles';

/** Pixels have already been bound to this row by the mounted route. */
export function ConversationSentPhoto({
  uri,
}: {
  readonly uri: string | readonly string[];
}) {
  return typeof uri === 'string' ? (
    <SentThumbnail uri={uri} />
  ) : (
    <>
      {uri.map((photo, index) => (
        <SentThumbnail key={index} uri={photo} />
      ))}
    </>
  );
}

function SentThumbnail({ uri }: { readonly uri: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ragConversation.photo.openFullScreen')}
        onPress={() => setOpened(true)}
        style={screen.userMessagePosition}
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
  thumbnail: { width: 180, maxWidth: '100%', height: 140, borderRadius: 12 },
});
