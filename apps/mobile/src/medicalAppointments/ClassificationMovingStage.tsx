import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  AppState,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { t } from '../i18n';
import {
  classificationDockGeometry,
  ClassificationCircleButton,
  ClassificationCircleDecoration,
} from './ClassificationCircle';
import { useClassificationExpandedDuo } from './classificationExpandedDuo';
import {
  ClassificationProgressCaption,
  ClassificationProgressRing,
} from './ClassificationProgress';

type Stage = 'confirmation' | 'progress' | 'results';

/** Progress and reclassify share one host and one animated position. Dismiss outgoing
 * content immediately; only the destination fades in, so old results are never exposed during work. */
export function ClassificationMovingStage({
  stage,
  classified,
  total,
  saving,
  onRestart,
  children,
}: {
  readonly stage: Stage;
  readonly classified: number;
  readonly total: number;
  readonly saving: boolean;
  readonly onRestart: () => void;
  readonly children: (
    dock: ReturnType<typeof classificationDockGeometry>,
    interactive: boolean,
  ) => ReactNode;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const window = useWindowDimensions();
  const expandedDuo = useClassificationExpandedDuo(window);
  const [bounds, setBounds] = useState<{ width: number; height: number }>();
  const { width, height } = bounds ?? window;
  // Before measuring the safe lane, a full window width does not prove an unobstructed list.
  const dock = classificationDockGeometry(
    bounds?.width ?? Math.min(width, 430),
    height,
    window.fontScale,
    Boolean(bounds && expandedDuo),
  );
  // Every moving state uses one diameter, including the 44pt short-pane fallback.
  const { size } = dock;
  const center = Math.max(0, (height - size) / 2);
  const target = stage === 'results' ? 1 : 0;
  const position = useRef(new Animated.Value(target)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const lastTarget = useRef(target);
  const lastStage = useRef(stage);
  const [ready, setReady] = useState<Stage | null>(stage);
  const [exposed, setExposed] = useState<Stage | null>(stage);
  useLayoutEffect(() => {
    const stageChanged = lastStage.current !== stage;
    const moved = lastTarget.current !== target;
    lastStage.current = stage;
    lastTarget.current = target;
    let current = true;
    let landed = false;
    let shown = false;
    let fade: Animated.CompositeAnimation | undefined;
    const expose = () => {
      if (!current || shown) return;
      shown = true;
      opacity.setValue(1);
      setExposed(stage);
    };
    const reveal = () => {
      if (!current) return;
      setReady(stage);
      if (reduceMotion || !stageChanged) {
        expose();
        return;
      }
      fade = Animated.timing(opacity, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      });
      fade.start(expose);
    };
    if (reduceMotion) {
      position.setValue(target);
      reveal();
      return;
    }
    if (!moved && !stageChanged) return;
    setExposed(null);
    opacity.setValue(0);
    if (moved) setReady(null);
    const slide =
      moved &&
      Animated.timing(position, {
        toValue: target,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    const settle = () => {
      if (!current || landed) return;
      landed = true;
      position.setValue(target);
      reveal();
    };
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') (landed ? expose : settle)();
    });
    if (slide) slide.start(settle);
    else settle();
    return () => {
      current = false;
      if (slide) slide.stop();
      fade?.stop();
      app.remove();
    };
  }, [opacity, position, reduceMotion, stage, target]);

  const settled = reduceMotion || ready === stage;
  const showingResults = stage === 'results';
  const interactive = reduceMotion || exposed === stage;
  const returning = stage === 'confirmation' && !interactive;
  return (
    <View
      style={styles.fill}
      testID="classification-moving-stage"
      onLayout={event => {
        const { width: nextWidth, height: nextHeight } =
          event.nativeEvent.layout;
        setBounds(old =>
          old?.width === nextWidth && old.height === nextHeight
            ? old
            : { width: nextWidth, height: nextHeight },
        );
      }}
    >
      {(!showingResults || settled) && (
        <Animated.View
          pointerEvents={interactive ? 'auto' : 'none'}
          accessibilityElementsHidden={!interactive}
          importantForAccessibility={
            interactive ? 'auto' : 'no-hide-descendants'
          }
          style={[styles.fill, { opacity }]}
        >
          {stage === 'progress' ? (
            <View style={styles.fill} testID="medical-appointment-progress">
              <ClassificationProgressCaption
                saving={saving}
                top={center + size + 8}
                height={height}
                fontScale={window.fontScale}
              />
            </View>
          ) : (
            children(dock, interactive)
          )}
        </Animated.View>
      )}
      <Animated.View
        pointerEvents="box-none"
        testID={
          stage === 'confirmation' && !returning
            ? undefined
            : 'classification-circle-slot'
        }
        style={[
          styles.slot,
          {
            height: size,
            width: size,
            left: (width - size) / 2,
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, dock.x],
                }),
              },
              {
                translateY: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [center, dock.centerOffset],
                }),
              },
            ],
          },
        ]}
      >
        {returning ? (
          <ClassificationCircleDecoration
            size={size}
            title={t('medicalAppointments.startShort')}
          />
        ) : showingResults && settled ? (
          <ClassificationCircleButton
            size={dock.size}
            title={t('medicalAppointments.restartShort')}
            label={t('medicalAppointments.startAgain')}
            disabled={!interactive}
            onPress={onRestart}
          />
        ) : stage === 'progress' || showingResults ? (
          <View
            accessibilityElementsHidden={showingResults}
            importantForAccessibility={
              showingResults ? 'no-hide-descendants' : 'auto'
            }
          >
            <ClassificationProgressRing
              classified={classified}
              total={total}
              saving={saving}
              size={size}
            />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  slot: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
});
