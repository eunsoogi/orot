import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { styles } from './ConversationActivityBubble.styles';

const DOT_OFFSETS = [0, 1, 2] as const;
const DOT_CYCLE_MS = 1_560;

/** One native-driven timeline animates decorative dots without rerendering the transcript. */
export function ConversationActivityBubble() {
  const [reduceMotion, setReduceMotion] = useState(true);
  const reduceMotionRef = useRef(true);
  const phase = useRef(new Animated.Value(0)).current;
  const dotStyles = useMemo(
    () =>
      DOT_OFFSETS.map(offset => {
        const inputRange = [
          offset,
          offset + 0.25,
          offset + 0.5,
          offset + 0.75,
          offset + 1,
        ];
        return {
          opacity: phase.interpolate({
            inputRange,
            outputRange: [0.5, 0.75, 0.95, 0.75, 0.5],
            extrapolate: 'clamp',
          }),
          translateY: phase.interpolate({
            inputRange,
            outputRange: [0, -1, -2, -1, 0],
            extrapolate: 'clamp',
          }),
        };
      }),
    [phase],
  );

  useEffect(() => {
    let mounted = true;
    let changeObserved = false;
    const updateReduceMotion = (enabled: boolean) => {
      changeObserved = true;
      if (!mounted || reduceMotionRef.current === enabled) return;
      reduceMotionRef.current = enabled;
      setReduceMotion(enabled);
    };

    // Subscribe before the asynchronous read so a newer system change wins.
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      updateReduceMotion,
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => {
        if (mounted && !changeObserved) updateReduceMotion(enabled);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    phase.stopAnimation();
    phase.setValue(0);
    if (reduceMotion) return;

    const animation = Animated.loop(
      Animated.timing(phase, {
        toValue: DOT_OFFSETS.length,
        duration: DOT_CYCLE_MS,
        isInteraction: false,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [phase, reduceMotion]);

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.bubble}
      testID="rag-conversation-activity-bubble"
    >
      {DOT_OFFSETS.map((offset, index) => (
        <Animated.View
          key={offset}
          accessible={false}
          style={[
            styles.dot,
            {
              opacity: dotStyles[index]?.opacity,
              transform: [{ translateY: dotStyles[index]?.translateY ?? 0 }],
            },
          ]}
          testID="rag-conversation-activity-dot"
        />
      ))}
    </View>
  );
}
