import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { ConversationSession } from '../ragConversation/conversationSessionTypes';
import { AvatarSymbol } from './AppearanceEditor';
import { defaultAssistantName } from './appearance';
import { useAssistantAppearance } from './AssistantAppearanceProvider';

const stages = {
  preparing: '요청을 준비하고 있어요',
  waiting: '응답을 기다리고 있어요',
  records: '기록을 살펴보고 있어요',
  literature: '의학 자료를 찾고 있어요',
  streaming: '답변을 작성하고 있어요',
  cancelling: '요청을 중단하고 있어요',
} as const;

export function activityLabel(session: ConversationSession): string | null {
  const activity = session.requestActivity;
  return activity &&
    activity.sessionId === session.id &&
    activity.requestId === session.pendingMessage?.id
    ? stages[activity.stage]
    : null;
}

export function AssistantHeader({ session }: { session: ConversationSession }) {
  const appearance = useAssistantAppearance();
  return appearance ? (
    <ActiveAssistantHeader session={session} appearance={appearance} />
  ) : null;
}

/** Announce only the live activity owned by the currently displayed session and request. */
function ActiveAssistantHeader({
  session,
  appearance,
}: {
  session: ConversationSession;
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
  const stage = activityLabel(session);
  const announced = useRef('');
  useEffect(() => {
    const identity =
      stage && activity && appearance.ready && focused && foreground
        ? `${activity.sessionId}:${activity.requestId}:${stage}`
        : '';
    if (identity && identity !== announced.current)
      AccessibilityInfo.announceForAccessibility(stage!);
    announced.current = identity;
  }, [activity, stage, appearance.ready, focused, foreground]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        appearance.value.name ?? defaultAssistantName,
        stage,
        '비서 꾸미기',
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={appearance.edit}
      style={styles.container}
    >
      <AvatarSymbol avatar={appearance.value.avatar} />
      <View style={styles.identity}>
        <AppText numberOfLines={1} style={styles.name}>
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
    gap: 12,
  },
  identity: { flex: 1, minWidth: 0 },
  name: { color: appColors.text, fontWeight: '700' },
  stage: { color: appColors.secondary },
});
