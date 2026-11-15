import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { MedicalDocumentPhotoViewport } from './MedicalDocumentPhotoViewport';

/** Presents verified pixels without exporting a file or changing the underlying saved record. */
export function MedicalDocumentPhotoFullScreen({
  photoURI,
  onClose,
  onError,
}: {
  readonly photoURI: string;
  readonly onClose: () => void;
  readonly onError: () => void;
}) {
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={onClose}
      testID="medical-document-photo-fullscreen"
    >
      <SafeAreaProvider>
        <SafeAreaView
          style={styles.screen}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <View style={styles.toolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                'medicalDocument.source.original.closeFullScreen',
              )}
              onPress={onClose}
              style={styles.close}
              testID="medical-document-photo-fullscreen-close"
            >
              <Text style={styles.label}>
                {t('medicalDocument.source.original.closeFullScreen')}
              </Text>
            </Pressable>
          </View>
          <MedicalDocumentPhotoViewport
            fullScreen
            imageReady
            photoURI={photoURI}
            onError={onError}
            onLoad={() => {}}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: appColors.background,
    padding: 12,
    gap: 12,
  },
  toolbar: { alignItems: 'flex-end' },
  close: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  label: { color: appColors.text, fontSize: 17, fontWeight: '600' },
});
