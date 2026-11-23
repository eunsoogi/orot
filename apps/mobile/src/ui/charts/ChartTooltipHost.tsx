import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentRef,
} from 'react';
import {
  AppState,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AppText } from '../../layout/AppText';
import {
  chartTooltipStyles as styles,
  chartTooltipFrameStyle,
} from './chartTooltipStyles';
import { useNavigationContentFrame } from '../../navigation/navigationContentFrame';
import { useNavigationGeometry } from '../../navigation/NavigationGeometryProvider';
import { useNavigationOcclusion } from '../../navigation/useNavigationContentInset';
import type { NavigationGeometryRect as Rect } from '../../navigation/navigationGeometry';
import {
  chartRectValid,
  placeChartTooltip,
  visibleChartTooltipPane,
  stableChartTooltipRect,
} from './chartTooltipPlacement';

type NativeView = ComponentRef<typeof View>;
type Topic = {
  readonly owner: symbol;
  readonly text: string;
  readonly testID?: string;
  readonly source: NativeView;
  readonly point: { x: number; y: number };
};
type Geometry = {
  readonly topic: Topic;
  readonly plot: Rect;
  readonly host: Rect;
  readonly serial: number;
};
type TooltipController = {
  readonly show: (topic: Topic) => void;
  readonly close: (owner: symbol) => void;
  readonly owns: (owner: symbol) => boolean;
};
const ChartTooltipContext = createContext<TooltipController | null>(null);

export function useChartTooltip() {
  return useContext(ChartTooltipContext);
}

function measure(node: NativeView, done: (rect: Rect) => void) {
  node.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
}

/** The route owns the floating view, outside plot/card masks but inside its
 * scrolling viewport; contents never claim touches or accessibility focus. */
export function ChartTooltipHost({
  children,
  style,
  testID,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  const hostRef = useRef<NativeView>(null);
  const request = useRef<Topic | null>(null);
  const serial = useRef(0);
  const [selection, setSelection] = useState<Geometry>();
  const [measurement, setMeasurement] = useState<{
    serial: number;
    width: number;
    height: number;
  }>();
  const { width, height, fontScale } = useWindowDimensions();
  const navigation = useContext(NavigationContext);
  const safe = useContext(SafeAreaInsetsContext);
  const frame = useNavigationContentFrame();
  const geometry = useNavigationGeometry();
  const { scrollContentInsets } = useNavigationOcclusion();
  const dismiss = useCallback(() => {
    request.current = null;
    setSelection(undefined);
  }, []);
  const close = useCallback(
    (owner: symbol) => {
      if (request.current?.owner === owner) dismiss();
    },
    [dismiss],
  );
  const show = useCallback(
    (topic: Topic) => {
      request.current = topic;
      const host = hostRef.current;
      const next = ++serial.current;
      if (
        !host ||
        navigation?.isFocused() === false ||
        (AppState.currentState != null && AppState.currentState !== 'active')
      )
        return dismiss();
      setSelection(undefined);
      measure(host, hostRect => {
        if (request.current !== topic || !chartRectValid(hostRect)) return;
        measure(topic.source, plot => {
          if (request.current !== topic || !chartRectValid(plot)) return;
          setSelection({ topic, plot, host: hostRect, serial: next });
        });
      });
    },
    [dismiss, navigation],
  );
  const controller = useMemo(
    () => ({
      show,
      close,
      owns: (owner: symbol) => request.current?.owner === owner,
    }),
    [show, close],
  );
  // Ignore any in-flight UIKit callback once the active window or route changes.
  useLayoutEffect(() => {
    dismiss();
    return () => {
      request.current = null;
    };
  }, [dismiss, width, height, fontScale, frame, geometry]);
  useEffect(() => {
    const removeBlur = navigation?.addListener('blur', dismiss);
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') dismiss();
    });
    return () => {
      removeBlur?.();
      subscription.remove();
    };
  }, [dismiss, navigation]);
  // Only while shown: scroll doesn't relayout a content child, so remeasure
  // its native position and dismiss rather than painting stale values in flight.
  useEffect(() => {
    if (!selection) return;
    let measuring = false;
    const timer = setInterval(() => {
      const host = hostRef.current;
      if (!host || measuring || request.current !== selection.topic) return;
      measuring = true;
      measure(selection.topic.source, plot => {
        measure(host, currentHost => {
          measuring = false;
          if (
            request.current === selection.topic &&
            (!stableChartTooltipRect(plot, selection.plot) ||
              !stableChartTooltipRect(currentHost, selection.host))
          )
            dismiss();
        });
      });
    }, 150);
    return () => clearInterval(timer);
  }, [dismiss, selection]);
  const anchor = selection && {
    x: selection.plot.x + selection.topic.point.x,
    y: selection.plot.y + selection.topic.point.y,
  };
  const route = frame?.availableContentFrame ?? {
    x: safe?.left ?? 0,
    y: safe?.top ?? 0,
    width: width - (safe?.left ?? 0) - (safe?.right ?? 0),
    height: height - (safe?.top ?? 0),
  };
  const clip =
    selection &&
    anchor &&
    visibleChartTooltipPane(
      route,
      selection.host,
      anchor,
      geometry?.usableRegions,
      frame?.side === 'bottom' ? frame.navigationFrame?.y : undefined,
      scrollContentInsets.bottom,
    );
  const calloutWidth =
    clip &&
    Math.max(0, Math.min(240 * Math.max(1, fontScale), clip.width - 16));
  const calloutHeight =
    measurement?.serial === selection?.serial &&
    measurement?.width === calloutWidth
      ? measurement?.height
      : undefined;
  const position =
    selection && anchor && clip && calloutWidth && calloutHeight
      ? placeChartTooltip(
          clip,
          selection.plot,
          anchor,
          calloutWidth,
          calloutHeight,
        )
      : undefined;
  return (
    <ChartTooltipContext.Provider value={controller}>
      <View
        ref={hostRef}
        collapsable={false}
        style={style}
        testID={testID}
        onTouchMove={dismiss}
      >
        {children}
        {selection && calloutWidth ? (
          <View
            key={selection.serial}
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={event =>
              setMeasurement({
                serial: selection.serial,
                width: calloutWidth,
                height: event.nativeEvent.layout.height,
              })
            }
            testID={selection.topic.testID}
            style={[
              styles.callout,
              chartTooltipFrameStyle(calloutWidth, selection.host, position),
            ]}
          >
            <AppText style={styles.text}>{selection.topic.text}</AppText>
          </View>
        ) : null}
      </View>
    </ChartTooltipContext.Provider>
  );
}
