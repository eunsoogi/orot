import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import { NavigationModal } from '../navigation/NavigationModal';
import type { useConversationRecordingAttachment } from './useConversationRecordingAttachment';

/** Native modal with rows limited to titles and recorded times, no transcript previews. */
export function ConversationRecordingPicker({
  attachment,
}: {
  readonly attachment: ReturnType<typeof useConversationRecordingAttachment>;
}) {
  const { rows, failed, more, loading } = attachment.page;
  return (
    <NavigationModal
      presentationStyle="pageSheet"
      onRequestClose={attachment.close}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <AppText accessibilityRole="header" style={styles.heading}>
            {t('ragConversation.recording.select')}
          </AppText>
          <AppButton
            title={t('ragConversation.recording.close')}
            variant="cancel"
            onPress={attachment.close}
          />
        </View>
        <FlatList
          testID="conversation-recording-options"
          data={rows}
          keyExtractor={row => row.key}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <AppButton
              title={item.title ?? t('ragConversation.recording.unnamed')}
              summary={formatDateTime(new Date(item.createdAt))}
              variant="list"
              onPress={() => {
                attachment.pick(item).catch(() => {});
              }}
            />
          )}
          ListEmptyComponent={
            !loading && !failed && !more ? (
              <AppText style={styles.notice}>
                {t('ragConversation.recording.empty')}
              </AppText>
            ) : undefined
          }
          ListFooterComponent={
            loading ? (
              <AppText accessibilityLiveRegion="polite" style={styles.notice}>
                {t('ragConversation.loading')}
              </AppText>
            ) : failed || more ? (
              <View>
                {failed ? (
                  <AppText accessibilityRole="alert" style={styles.notice}>
                    {t('ragConversation.recording.unavailable')}
                  </AppText>
                ) : null}
                <AppButton
                  title={t(
                    failed
                      ? 'ragConversation.recording.retry'
                      : 'ragConversation.recording.more',
                  )}
                  variant="text"
                  onPress={attachment.more}
                />
              </View>
            ) : undefined
          }
        />
      </SafeAreaView>
    </NavigationModal>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: appColors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  heading: { flex: 1, fontSize: 20, fontWeight: '600', color: appColors.text },
  notice: { color: appColors.secondary, padding: 16 },
});
