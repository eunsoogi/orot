import { useLayoutEffect, useMemo, useRef } from 'react';
import { AppState, NativeModules, type TextProps } from 'react-native';

type Row = 'ordinary' | 'workout';
type TextLayout = NonNullable<TextProps['onTextLayout']>;
type Sink = {
  enabled?: boolean;
  report(feature: string, stage: Row, outcome: 'laid_out'): void;
};

function sink(): Sink | undefined {
  try {
    const module = NativeModules.OrotProviderDiagnostics as Sink | undefined;
    return module?.enabled === true ? module : undefined;
  } catch {
    return undefined;
  }
}

/** First positive native text layout per focused row. A layout receipt is not a
 * pixel/viewport observation or a publication authority. */
export function useOverviewHeartFirstLayout(
  row: Row,
  focused: boolean,
  ready: boolean,
): TextLayout | undefined {
  const enabled = !!sink();
  const current = useRef<object | null>(null);
  const reported = useRef(false);
  const candidate = useMemo(() => {
    if (!enabled || !focused || !ready) return;
    const token = {};
    const onTextLayout: TextLayout = event => {
      if (
        current.current !== token ||
        reported.current ||
        AppState.currentState !== 'active' ||
        !event.nativeEvent.lines.some(line => line.width > 0 && line.height > 0)
      )
        return;
      reported.current = true;
      try {
        sink()?.report('overview_heart_first_layout', row, 'laid_out');
      } catch {
        // An optional local receipt never changes the rendered metric.
      }
    };
    return { token, onTextLayout };
  }, [enabled, focused, ready, row]);
  useLayoutEffect(() => {
    if (!focused) reported.current = false;
    current.current = candidate?.token ?? null;
    return () => {
      current.current = null;
    };
  }, [candidate, focused]);
  return candidate?.onTextLayout;
}
