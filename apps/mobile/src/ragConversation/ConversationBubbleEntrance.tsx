import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { Animated, Easing, View, type ViewProps } from 'react-native';
import {
  AnimatedConversationBubbleCopyHost,
  ConversationBubbleCopyHost,
  type ConversationBubbleCopy,
} from './ConversationBubbleCopyHost';
import type { createConversationBubbleEntrances } from './conversationBubbleEntrances';

export const ConversationBubbleEntranceContext = createContext<{
  readonly receipts: ReturnType<typeof createConversationBubbleEntrances>;
  readonly motionAllowed: boolean;
} | null>(null);

/** Replace the painted surface in place; a scale never shifts native row layout. */
export function ConversationBubbleEntrance({
  entranceKey,
  restored,
  copyMenu,
  style,
  ...props
}: ViewProps & {
  readonly entranceKey?: string;
  readonly restored?: boolean;
  readonly copyMenu?: ConversationBubbleCopy;
}) {
  const context = useContext(ConversationBubbleEntranceContext);
  // Cold and standalone previews keep their original View and allocate no timeline.
  if (!context || !entranceKey || restored)
    return copyMenu && ConversationBubbleCopyHost ? (
      <ConversationBubbleCopyHost {...props} {...copyMenu} style={style} />
    ) : (
      <View {...props} style={style} />
    );
  return (
    <LiveConversationBubble
      {...props}
      style={style}
      copyMenu={copyMenu}
      entranceKey={entranceKey}
      {...context}
    />
  );
}

function LiveConversationBubble({
  receipts,
  motionAllowed,
  entranceKey,
  copyMenu,
  style,
  ...props
}: ViewProps & {
  readonly receipts: ReturnType<typeof createConversationBubbleEntrances>;
  readonly motionAllowed: boolean;
  readonly entranceKey: string;
  readonly copyMenu?: ConversationBubbleCopy;
}) {
  const [{ scale, opacity }] = useState(() => {
    const progress = new Animated.Value(1);
    // Reuse the spring's first leg. Opacity remains 1 throughout overshoot and settle.
    const fade = progress.interpolate({
      inputRange: [0.985, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });
    return { scale: progress, opacity: fade };
  });
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
  const paintedStyle = [style, { opacity, transform: [{ scale }] }];
  if (copyMenu && AnimatedConversationBubbleCopyHost)
    return (
      <AnimatedConversationBubbleCopyHost
        {...props}
        {...copyMenu}
        style={paintedStyle}
      />
    );
  return <Animated.View {...props} style={paintedStyle} />;
}
