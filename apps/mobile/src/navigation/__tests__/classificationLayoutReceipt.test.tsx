import { act, renderHook } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { useClassificationLayoutReceipt } from '../../../e2e/classificationLayoutReceipt';

const originalControl = NativeModules.OrotTestControl;
const originalSettings = NativeModules.SettingsManager;
afterEach(() => {
  if (originalControl === undefined) delete NativeModules.OrotTestControl;
  else NativeModules.OrotTestControl = originalControl;
  NativeModules.SettingsManager = originalSettings;
});

test('only explicit staged opt-in samples once per diagnostic request', async () => {
  const navigationSnapshot = jest.fn().mockResolvedValue({
    windowGeometry: {
      windowBounds: { x: 0, y: 0, width: 429, height: 647 },
      safeAreaInsets: { top: 57, right: 0, bottom: 34, left: 0 },
      dockControls: { contentSizeCategory: 'UICTContentSizeCategoryXL' },
    },
  });
  NativeModules.OrotTestControl = { navigationSnapshot };
  NativeModules.SettingsManager = {
    settings: { OROT_TEST_CLASSIFICATION_LAYOUT: 'YES' },
  };
  const disabled = await renderHook(() =>
    useClassificationLayoutReceipt(false),
  );
  expect(disabled.result.current.request).toBeUndefined();
  expect(disabled.result.current.marker).toBeNull();
  const enabled = await renderHook(() => useClassificationLayoutReceipt(true));
  expect(navigationSnapshot).not.toHaveBeenCalled();
  await act(async () => {
    await enabled.result.current.request?.();
  });
  expect(navigationSnapshot).toHaveBeenCalledTimes(1);
  const receipt = JSON.parse(
    enabled.result.current.marker!.props.accessibilityLabel,
  );
  expect(receipt.windowBounds.width).toBe(429);
  expect(receipt.contentSizeCategory).toBe('UICTContentSizeCategoryXL');
  expect(receipt.requestId).toBe(1);
  expect(enabled.result.current.marker!.props.pointerEvents).toBe('none');
});

test('bridge failure reports unavailable instead of inventing geometry', async () => {
  NativeModules.SettingsManager = {
    settings: { OROT_TEST_CLASSIFICATION_LAYOUT: 'YES' },
  };
  NativeModules.OrotTestControl = {
    navigationSnapshot: jest.fn().mockRejectedValue(new Error('unavailable')),
  };
  const view = await renderHook(() => useClassificationLayoutReceipt(true));
  await act(async () => {
    await view.result.current.request?.();
  });
  const receipt = JSON.parse(
    view.result.current.marker!.props.accessibilityLabel,
  );
  expect(receipt.status).toBe('unavailable');
  expect(receipt.windowBounds).toBeUndefined();
});
