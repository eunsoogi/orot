import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { AppSymbol } from '../layout/AppSymbol';

/** Displays only the current composer preview. It does not resolve a file or own an attachment. */
export function ConversationPhotoViewer({
  photoURI,
  onClose,
}: {
  readonly photoURI: string;
  readonly onClose: () => void;
}) {
  return (
    <Modal
      visible
      presentationStyle="fullScreen"
      animationType="fade"
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={onClose}
      testID="conversation-photo-viewer"
    >
      <SafeAreaProvider>
        <View
          style={styles.screen}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <ScrollView
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            bouncesZoom
            centerContent
            contentContainerStyle={styles.content}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={styles.viewport}
            testID="conversation-photo-viewer-zoom"
          >
            <Image
              accessibilityRole="image"
              accessibilityLabel={t('ragConversation.photo.preview')}
              onError={onClose}
              resizeMode="contain"
              source={{ uri: photoURI }}
              style={styles.photo}
              testID="conversation-photo-viewer-image"
            />
          </ScrollView>
          <SafeAreaView
            edges={['top', 'left', 'right']}
            pointerEvents="box-none"
            style={styles.controls}
            testID="conversation-photo-viewer-controls"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ragConversation.photo.closeFullScreen')}
              onPress={onClose}
              style={styles.close}
            >
              <AppSymbol name="xmark" size={22} color="#fff" />
            </Pressable>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  controls: { position: 'absolute', top: 0, left: 0, right: 0 },
  close: {
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
    marginRight: 8,
  },
  viewport: { flex: 1 },
  content: { flexGrow: 1 },
  photo: { width: '100%', height: '100%' },
});
