import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { ComposerGlassBackground } from '../ragConversation/ComposerGlassBackground';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { ConversationSession } from '../ragConversation/conversationSessionTypes';
import { AvatarSymbol } from './AppearanceEditor';
import { defaultAssistantName } from './appearance';
import { useAssistantAppearance } from './AssistantAppearanceProvider';

const stages = {
  preparing: 'assistantAppearance.preparing',
  waiting: 'assistantAppearance.waiting',
  records: 'assistantAppearance.records',
  literature: 'assistantAppearance.literature',
  streaming: 'assistantAppearance.streaming',
  cancelling: 'assistantAppearance.cancelling',
} as const;

export function activityLabel(session: ConversationSession): string | null {
  const activity = session.requestActivity;
  return activity &&
    activity.sessionId === session.id &&
    activity.requestId === session.pendingMessage?.id
    ? t(stages[activity.stage])
    : null;
}

export function AssistantHeader({
  session,
  status,
  editable = true,
}: {
  session: ConversationSession;
  status?: string | null;
  editable?: boolean;
}) {
  const appearance = useAssistantAppearance();
  return appearance ? (
    <ActiveAssistantHeader
      session={session}
      appearance={appearance}
      status={status}
      editable={editable}
    />
  ) : null;
}

/** Announce only the live activity owned by the currently displayed session and request. */
function ActiveAssistantHeader({
  session,
  appearance,
  status,
  editable,
}: {
  session: ConversationSession;
  status?: string | null;
  editable: boolean;
  appearance: NonNullable<ReturnType<typeof useAssistantAppearance>>;
}) {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setForeground(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  const activity = session.requestActivity;
  // An explicit voice phase owns this one subtitle instead of duplicating request progress.
  const stage = status === undefined ? activityLabel(session) : status;
  const announced = useRef('');
  useEffect(() => {
    const identity =
      stage && appearance.ready && focused && foreground
        ? `${session.id}:${activity?.requestId ?? 'voice'}:${stage}`
        : '';
    if (identity && identity !== announced.current)
      AccessibilityInfo.announceForAccessibility(stage!);
    announced.current = identity;
  }, [activity, stage, session.id, appearance.ready, focused, foreground]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        appearance.value.name ?? defaultAssistantName,
        stage,
        t('assistantAppearance.title'),
      ]
        .filter(Boolean)
        .join(', ')}
      // Full-screen voice must end before opening identity settings.
      disabled={!editable}
      accessibilityState={{ disabled: !editable }}
      onPress={appearance.edit}
      style={styles.container}
      testID="assistant-floating-identity"
    >
      <ComposerGlassBackground />
      <AvatarSymbol avatar={appearance.value.avatar} />
      <View style={styles.identity}>
        <AppText style={styles.name}>
          {appearance.value.name ?? defaultAssistantName}
        </AppText>
        {stage ? <AppText style={styles.stage}>{stage}</AppText> : null}
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 360,
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: appColors.border,
    overflow: 'hidden',
  },
  identity: { flex: 1, minWidth: 0 },
  name: { color: appColors.text, fontWeight: '700' },
  stage: { color: appColors.secondary },
});
