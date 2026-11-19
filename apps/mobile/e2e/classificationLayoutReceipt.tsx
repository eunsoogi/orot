import { useRef, useState } from 'react';
import { NativeModules, StyleSheet, Text } from 'react-native';

/** Whitelist native geometry only; never export the navigation transcript or fixture payload. */
export function classificationLayoutFields(value: unknown) {
  const geometry = (value as { windowGeometry?: Record<string, unknown> })
    ?.windowGeometry;
  const dock = geometry?.dockControls as Record<string, unknown> | undefined;
  const rect = (input: unknown, keys: string[]) => {
    const record = input as Record<string, unknown> | undefined;
    return Object.fromEntries(
      keys.flatMap(key =>
        typeof record?.[key] === 'number' && Number.isFinite(record[key])
          ? [[key, record[key]]]
          : [],
      ),
    );
  };
  return {
    windowBounds: rect(geometry?.windowBounds, ['x', 'y', 'width', 'height']),
    safeAreaInsets: rect(geometry?.safeAreaInsets, [
      'top',
      'right',
      'bottom',
      'left',
    ]),
    windowFrameInScreen: rect(dock?.windowFrameInScreen, [
      'x',
      'y',
      'width',
      'height',
    ]),
    contentSizeCategory:
      typeof dock?.contentSizeCategory === 'string' &&
      /^UICTContentSizeCategory(?:XS|S|M|L|XL|XXL|XXXL|AccessibilityM|AccessibilityL|AccessibilityXL|AccessibilityXXL|AccessibilityXXXL)$/.test(
        dock.contentSizeCategory,
      )
        ? dock.contentSizeCategory
        : null,
    visibleKeyWindowCount:
      typeof dock?.visibleKeyWindowCount === 'number'
        ? dock.visibleKeyWindowCount
        : null,
    dockSampleStartedAtMs:
      typeof dock?.sampleStartedAtMs === 'number' &&
      Number.isFinite(dock.sampleStartedAtMs)
        ? dock.sampleStartedAtMs
        : null,
    dockSampleEndedAtMs:
      typeof dock?.sampleEndedAtMs === 'number' &&
      Number.isFinite(dock.sampleEndedAtMs)
        ? dock.sampleEndedAtMs
        : null,
    sampleStartedAtMs:
      typeof geometry?.sampleStartedAtMs === 'number' &&
      Number.isFinite(geometry.sampleStartedAtMs)
        ? geometry.sampleStartedAtMs
        : null,
    sampleEndedAtMs:
      typeof geometry?.sampleEndedAtMs === 'number' &&
      Number.isFinite(geometry.sampleEndedAtMs)
        ? geometry.sampleEndedAtMs
        : null,
  };
}

/** Explicit taps on the existing diagnostic counter sample UIKit, without adding layout or changing OS state. */
export function useClassificationLayoutReceipt(staged: boolean) {
  const [receipt, setReceipt] = useState('{}');
  const sequence = useRef(0);
  const manager = NativeModules.SettingsManager;
  const settings =
    manager?.settings ?? manager?.getConstants?.().settings ?? {};
  const enabled = staged && settings.OROT_TEST_CLASSIFICATION_LAYOUT === 'YES';
  const request = enabled
    ? async () => {
        const requestId = ++sequence.current;
        const requestedAtMs = Date.now();
        try {
          const native =
            await NativeModules.OrotTestControl.navigationSnapshot();
          setReceipt(
            JSON.stringify({
              requestId,
              requestedAtMs,
              ...classificationLayoutFields(native),
            }),
          );
        } catch {
          setReceipt(
            JSON.stringify({ requestId, requestedAtMs, status: 'unavailable' }),
          );
        }
      }
    : undefined;
  return {
    request,
    marker: enabled ? (
      <Text
        accessible
        pointerEvents="none"
        style={styles.receipt}
        testID="classification-layout-receipt"
        accessibilityLabel={receipt}
      >
        {receipt}
      </Text>
    ) : null,
  };
}

const styles = StyleSheet.create({
  receipt: {
    position: 'absolute',
    width: 1,
    height: 1,
    fontSize: 1,
    bottom: 0,
    right: 0,
  },
});
