import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppRegistry, AppState, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { AppButton } from '../src/layout/AppButton';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import { ConversationHistory } from '../src/ragConversation/ConversationHistory';
import {
  replyFocus,
  useReplyFocusForSession,
} from '../src/replyNotifications/replyFocus';

const messages = Array.from({ length: 32 }, (_, index) => ({
  id: index + 1,
  role: 'assistant' as const,
  retainedTurnId: `synthetic-reply-${index + 1}`,
  content: `Synthetic reply ${index + 1}`,
}));

/** Synthetic reply identities exercise production history layout, never system delivery. */
function Transcript({ isCurrent }: { isCurrent: () => boolean }) {
  const focus = useReplyFocusForSession(1, isCurrent);
  return (
    <ConversationHistory
      messages={messages}
      pendingMessage={null}
      error=""
      onOpenSource={() => {}}
      onLinkError={() => {}}
      replyFocus={focus}
    />
  );
}

function Probe() {
  const [controller] = useState(() =>
    createNavigationController<'conversation' | 'other'>('conversation'),
  );
  const backgroundArmed = useRef(false);
  const [armed, setArmed] = useState(false);
  const [backgroundDelivered, setBackgroundDelivered] = useState(false);
  const [receipt, setReceipt] = useState('none');
  const target = useSyncExternalStore(replyFocus.subscribe, replyFocus.get);
  useEffect(() => {
    let previous = replyFocus.get();
    const stop = replyFocus.subscribe(() => {
      const next = replyFocus.get();
      if (!next && previous)
        setReceipt(`completed:${previous.messageId}:${previous.generation}`);
      previous = next;
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'background' || !backgroundArmed.current) return;
      backgroundArmed.current = false;
      setArmed(false);
      setBackgroundDelivered(true);
      // This synthetic identity exercises actual foreground recovery, not an OS notification.
      replyFocus.set({ sessionId: 1, messageId: 'synthetic-reply-4' });
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.controls}>
          <AppButton
            title="Focus saved reply"
            onPress={() =>
              replyFocus.set({ sessionId: 1, messageId: 'synthetic-reply-4' })
            }
          />
          <AppButton
            title="Focus newer generation"
            onPress={() => {
              replyFocus.set({ sessionId: 1, messageId: 'synthetic-reply-4' });
              replyFocus.set({ sessionId: 1, messageId: 'synthetic-reply-24' });
            }}
          />
        </View>
        <AppButton
          title={armed ? 'Background reply armed' : 'Arm background reply'}
          onPress={() => {
            backgroundArmed.current = true;
            setArmed(true);
            setBackgroundDelivered(false);
          }}
        />
        <Text testID="reply-focus-probe-receipt">{receipt}</Text>
        <Text testID="reply-focus-probe-background">
          {backgroundDelivered
            ? 'background-delivered'
            : 'background-not-delivered'}
        </Text>
        <Text testID="reply-focus-probe-state">
          {target ? `pending:${target.messageId}` : 'idle'}
        </Text>
        <NavigationRouteAdapter
          controller={controller}
          leaveState={{
            readState: () => ({
              hasUnsavedChanges: false,
              isRecording: false,
              hasOngoingOperation: false,
              revision: 0,
              inputRevision: 0,
            }),
          }}
        >
          {navigation =>
            navigation.route.name === 'conversation' ? (
              <Transcript
                isCurrent={() =>
                  AppState.currentState === 'active' &&
                  controller.getSnapshot().currentRoute.key ===
                    navigation.route.key
                }
              />
            ) : (
              <Text>Other route</Text>
            )
          }
        </NavigationRouteAdapter>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: { flexDirection: 'row' },
});
AppRegistry.registerComponent(appName, () => Probe);
