import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { Animated, Easing, View, type ViewProps } from 'react-native';
import type { createConversationBubbleEntrances } from './conversationBubbleEntrances';

export const ConversationBubbleEntranceContext = createContext<{
  readonly receipts: ReturnType<typeof createConversationBubbleEntrances>;
  readonly motionAllowed: boolean;
} | null>(null);

/** Replace the painted surface in place; a scale never shifts native row layout. */
export function ConversationBubbleEntrance({
  entranceKey,
  restored,
  style,
  ...props
}: ViewProps & {
  readonly entranceKey?: string;
  readonly restored?: boolean;
}) {
  const context = useContext(ConversationBubbleEntranceContext);
  // Cold and standalone previews keep their original View and allocate no timeline.
  if (!context || !entranceKey || restored)
    return <View {...props} style={style} />;
  return (
    <LiveConversationBubble
      {...props}
      style={style}
      entranceKey={entranceKey}
      {...context}
    />
  );
}

function LiveConversationBubble({
  receipts,
  motionAllowed,
  entranceKey,
  style,
  ...props
}: ViewProps & {
  readonly receipts: ReturnType<typeof createConversationBubbleEntrances>;
  readonly motionAllowed: boolean;
  readonly entranceKey: string;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  useLayoutEffect(() => {
    if (!receipts.claim(entranceKey, motionAllowed)) return;
    scale.setValue(0.985);
    const options = { useNativeDriver: true, isInteraction: false };
    const settle = Animated.sequence([
      Animated.timing(scale, {
        ...options,
        toValue: 1.012,
        duration: 95,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(scale, {
        ...options,
        toValue: 1,
        duration: 115,
        easing: Easing.inOut(Easing.quad),
      }),
    ]);
    // No completion callback can publish after replacement or unmount.
    settle.start();
    return () => {
      settle.stop();
      scale.setValue(1);
    };
  }, [motionAllowed, receipts, entranceKey, scale]);
  return (
    <Animated.View {...props} style={[style, { transform: [{ scale }] }]} />
  );
}
