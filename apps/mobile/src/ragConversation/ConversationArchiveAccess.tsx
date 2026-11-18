import { styles as transcriptStyles } from './ConversationScreen.styles';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { createConversationArchive } from './conversationArchive';

/** Independent read-only presentation. Closing never selects a different dispatch epoch. */
export function ConversationArchiveAccess({
  archive,
  active = true,
}: {
  readonly active?: boolean;
  readonly archive: ReturnType<typeof createConversationArchive>;
}) {
  const [open, setOpen] = useState(false);
  const state = useSyncExternalStore(archive.subscribe, archive.getSnapshot);
  useEffect(() => () => archive.invalidate(), [archive]);
  useEffect(() => {
    if (!active) {
      archive.invalidate();
      setOpen(false);
    }
  }, [archive, active]);
  if (!archive.available) return null;
  const close = () => {
    archive.invalidate();
    setOpen(false);
  };
  return (
    <>
      <AppButton
        title={t('ragConversation.archive.open')}
        variant="text"
        disabled={!active}
        onPress={() => {
          setOpen(true);
          archive.list().catch(() => {});
        }}
      />
      <Modal
        visible={open && active}
        onRequestClose={close}
        animationType="slide"
      >
        <SafeAreaProvider>
          <SafeAreaView style={styles.root}>
            <AppButton
              title={t('ragConversation.archive.close')}
              onPress={close}
              variant="text"
            />
            <ScrollView
              contentContainerStyle={styles.content}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              testID="conversation-readonly-archive"
            >
              <Text accessibilityRole="header" style={styles.title}>
                {t('ragConversation.archive.title')}
              </Text>
              <Text>{t('ragConversation.archive.notice')}</Text>
              <Text>{t('ragConversation.archive.textOnly')}</Text>
              {state.sessions.map(row => (
                <AppButton
                  key={row.id}
                  variant="list"
                  title={new Date(row.updatedAt).toLocaleString('ko-KR')}
                  accessibilityState={{ selected: state.selected === row.id }}
                  onPress={() => {
                    archive.select(row.id).catch(() => {});
                  }}
                />
              ))}
              {state.sessionCursor ? (
                <AppButton
                  title={t('ragConversation.archive.moreSessions')}
                  disabled={state.loading}
                  onPress={() => {
                    archive.list(true).catch(() => {});
                  }}
                />
              ) : null}
              {!state.sessions.length && !state.loading ? (
                <>
                  <Text>{t('ragConversation.archive.empty')}</Text>
                  <AppButton
                    title={t('ragConversation.archive.reload')}
                    onPress={() => {
                      archive.list().catch(() => {});
                    }}
                  />
                </>
              ) : null}
              {state.failed ? (
                <Text accessibilityRole="alert">
                  {t('ragConversation.archive.failed')}
                </Text>
              ) : null}
              {state.loading ? (
                <Text accessibilityRole="progressbar">
                  {t('ragConversation.history.loading')}
                </Text>
              ) : null}
              {state.selected && (state.cursor || state.failed) ? (
                <AppButton
                  disabled={state.loading}
                  title={
                    state.failed
                      ? t('ragConversation.history.retry')
                      : t('ragConversation.history.earlier')
                  }
                  onPress={() => {
                    archive.loadOlder().catch(() => {});
                  }}
                />
              ) : null}
              {state.selected &&
              !state.loading &&
              !state.failed &&
              !state.lines.length ? (
                <Text>{t('ragConversation.archive.noText')}</Text>
              ) : null}
              {state.lines.map(line => (
                <View key={line.key} style={styles.message}>
                  <Text accessibilityRole="header">
                    {t(
                      line.role === 'user'
                        ? 'ragConversation.archive.question'
                        : 'ragConversation.archive.answer',
                    )}
                  </Text>
                  <Text selectable style={transcriptStyles.messageText}>
                    {line.content}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: appColors.background },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: appColors.text },
  message: {
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    borderRadius: 12,
  },
});
