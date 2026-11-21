import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { GlassIconButton } from '../layout/GlassIconButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { COMPACT_APP_SYMBOL_POINT_SIZE } from '../layout/iconSizing';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { t } from '../i18n';

type Phase = 'hidden' | 'entering' | 'visible' | 'exiting';
export const jumpLatestFadeDuration = 120;

/** Use the same measured anchor throughout. A decorative transition does not
 * alpha-composite a UIKit glass ancestor or show a second interactive control. */
export function ConversationJumpToLatest({
  visible,
  bottom,
  onPress,
}: {
  readonly visible: boolean;
  readonly bottom: number;
  readonly onPress: () => void;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>('hidden');
  const [opacity] = useState(() => new Animated.Value(0));
  const glass = visible && (reduceMotion || phase === 'visible');
  const ghost = !reduceMotion && !glass && (visible || phase !== 'hidden');

  useLayoutEffect(() => {
    const target: Phase = visible ? 'visible' : 'hidden';
    const change = (next: Phase) => {
      phaseRef.current = next;
      setPhase(next);
    };
    if (reduceMotion || phaseRef.current === target) {
      opacity.setValue(visible ? 1 : 0);
      change(target);
      return;
    }
    change(visible ? 'entering' : 'exiting');
    let current = true;
    const animation = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: jumpLatestFadeDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (!current || !finished) return;
      opacity.setValue(visible ? 1 : 0);
      change(target);
    });
    return () => {
      current = false;
      animation.stop();
    };
  }, [opacity, reduceMotion, visible]);

  if (!glass && !ghost) return null;
  return (
    <View
      pointerEvents={glass ? 'box-none' : 'none'}
      accessibilityElementsHidden={!glass}
      importantForAccessibility={glass ? 'auto' : 'no-hide-descendants'}
      style={[styles.host, { bottom: bottom + 8 }]}
      testID="conversation-jump-latest-position"
    >
      {glass ? (
        <JumpLatestAction onPress={onPress} />
      ) : (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.button, { opacity }]}
          testID="conversation-jump-latest-fade"
        >
          <View style={styles.ghost}>
            <AppSymbol
              name="arrow.down"
              size={COMPACT_APP_SYMBOL_POINT_SIZE / 2}
              color={appColors.text}
            />
          </View>
        </Animated.View>
      )}
    </View>
  );
}
function JumpLatestAction({ onPress }: { readonly onPress: () => void }) {
  const liveAction = useRef<(() => void) | null>(null);
  // The retired native action must stay inert even after a new button appears.
  useLayoutEffect(() => {
    liveAction.current = onPress;
    return () => {
      liveAction.current = null;
    };
  }, [onPress]);
  return (
    <GlassIconButton
      symbolName="arrow.down"
      visualScale={0.5}
      accessibilityLabel={t('ragConversation.jumpLatest')}
      onPress={() => liveAction.current?.()}
      style={styles.button}
      testID="conversation-jump-latest"
    />
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: appColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
