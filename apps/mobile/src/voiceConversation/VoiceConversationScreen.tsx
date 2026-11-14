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
    symbol?: string,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={press}
      style={[styles.button, danger && styles.end]}
    >
      {symbol ? (
        <AppSymbol
          name={symbol}
          size={28}
          color={danger ? appColors.onDanger : appColors.text}
        />
      ) : null}
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
          <AppText style={styles.note}>
            {manualFinish ? '기기 음성 대화' : '실시간 음성 대화'}
          </AppText>
          <View style={styles.center}>
            <View style={styles.identity}>{identity}</View>
            {/* This is a phase symbol, not a fabricated audio amplitude or waveform. */}
            <AppSymbol
              name={
                muted
                  ? 'mic.slash'
                  : phase === 'listening' || phase === 'speaking'
                    ? 'waveform'
                    : 'ellipsis'
              }
              size={32}
              color={appColors.primary}
            />
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
                  false,
                  'mic',
                )
              : phase !== 'cleaning' &&
                phase !== 'error' &&
                action(
                  t('ragConversation.voice.mute'),
                  onMute,
                  'voice-call-mute',
                  false,
                  'mic.slash',
                )}
            {action(
              t('ragConversation.voice.endCall'),
              onEnd,
              'voice-call-end',
              true,
              'phone.down.fill',
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 20,
  },
  button: {
    minHeight: 76,
    minWidth: 92,
    maxWidth: 160,
    gap: 8,
    borderRadius: 38,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.surface,
  },
  label: { color: appColors.text },
  end: { backgroundColor: appColors.dangerAction },
  endText: { color: appColors.onDanger },
});
