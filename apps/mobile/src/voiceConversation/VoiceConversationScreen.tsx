import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import SafeAreaLayout from '../layout/SafeAreaLayout';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { VoicePhase } from './voiceTurn';

/** A consented voice session owns this surface; rendering alone never activates audio. */
export function VoiceConversationScreen({
  visible,
  phase,
  status,
  identity,
  pipeline,
  transcript,
  onEnd,
  onMute,
  onResume,
  onInterrupt,
  onFinish,
  manualFinish = true,
}: {
  visible: boolean;
  phase: VoicePhase;
  status: string;
  identity?: ReactNode;
  pipeline?: string;
  transcript?: ReactNode;
  onEnd: () => void;
  onMute: () => void;
  onResume: () => void;
  onInterrupt: () => void;
  onFinish: () => void;
  manualFinish?: boolean;
}) {
  const muted = phase === 'stopped' || phase === 'ended';
  const interruptible = phase === 'processing' || phase === 'speaking';
  const action = (
    label: string,
    press: () => void,
    testID: string,
    danger = false,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={press}
      style={[styles.button, danger && styles.end]}
    >
      <AppText style={danger ? styles.endText : styles.label}>{label}</AppText>
    </Pressable>
  );
  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onEnd}
    >
      <SafeAreaLayout>
        <ScrollView
          testID="voice-call-screen"
          contentContainerStyle={styles.content}
        >
          <View style={styles.identity}>{identity}</View>
          <View style={styles.center}>
            <AppSymbol
              name={muted ? 'mic.slash' : 'waveform'}
              color={appColors.primary}
            />
            <AppText accessibilityRole="header" style={styles.title}>
              {t('ragConversation.voice.callTitle')}
            </AppText>
            <AppText accessibilityLiveRegion="polite" style={styles.status}>
              {muted ? t('ragConversation.voice.muted') : status}
            </AppText>
            <AppText style={styles.note}>
              {pipeline ?? t('ragConversation.voice.localPipeline')}
            </AppText>
          </View>
          {transcript}
          <View style={styles.actions}>
            {manualFinish &&
              phase === 'listening' &&
              action(
                t('ragConversation.voice.finish'),
                onFinish,
                'voice-call-finish',
              )}
            {interruptible &&
              action(
                t('ragConversation.voice.interrupt'),
                onInterrupt,
                'voice-call-interrupt',
              )}
            {muted
              ? action(
                  t('ragConversation.voice.resume'),
                  onResume,
                  'voice-call-resume',
                )
              : phase !== 'cleaning' &&
                phase !== 'error' &&
                action(
                  t('ragConversation.voice.mute'),
                  onMute,
                  'voice-call-mute',
                )}
            {action(
              t('ragConversation.voice.endCall'),
              onEnd,
              'voice-call-end',
              true,
            )}
          </View>
        </ScrollView>
      </SafeAreaLayout>
    </Modal>
  );
}
const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 24, gap: 24 },
  identity: { alignSelf: 'center', maxWidth: '100%' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 },
  title: {
    color: appColors.text,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  status: { color: appColors.text, textAlign: 'center' },
  note: { color: appColors.secondary, textAlign: 'center' },
  actions: { gap: 12 },
  button: {
    minHeight: 48,
    borderRadius: 24,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.surface,
  },
  label: { color: appColors.text },
  end: { backgroundColor: appColors.dangerAction },
  endText: { color: appColors.onDanger },
});
