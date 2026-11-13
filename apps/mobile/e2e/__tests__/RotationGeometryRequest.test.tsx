import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { RotationGeometryRequest } from '../RotationGeometryRequest';

test('requests a fresh sample and emits only the allowed geometry fields', async () => {
  const navigationSnapshot = jest.fn().mockResolvedValue({
    windowGeometry: {
      windowBounds: { width: 466 },
      safeAreaInsets: { bottom: 34 },
      sceneOrientation: 1,
      sampleStartedAtMs: 123,
      sampleEndedAtMs: 124,
      orientationPolicy: {
        rootSupportedMask: 30,
        sceneLocked: false,
        privateContent: 'must not appear',
      },
      privateContent: 'must not appear',
    },
    privateContent: 'must not appear',
  });
  NativeModules.OrotTestControl = { navigationSnapshot };
  await render(<RotationGeometryRequest session="sample-session" />);
  await fireEvent.press(screen.getByTestId('rotation-geometry-request'));
  await waitFor(() => {
    const receipt = JSON.parse(
      screen.getByTestId('rotation-geometry-request').props.accessibilityLabel,
    );
    expect(receipt.requestId).toBe('sample-session');
    expect(receipt.windowGeometry.windowBounds.width).toBe(466);
    expect(receipt.windowGeometry.privateContent).toBeUndefined();
    expect(receipt.windowGeometry.orientationPolicy).toEqual({
      rootSupportedMask: 30,
      sceneLocked: false,
    });
    expect(receipt.privateContent).toBeUndefined();
  });
  expect(navigationSnapshot).toHaveBeenCalledTimes(1);
});

test('arms, requests once, and then reads the transition receipt', async () => {
  const rotationGeometryCommand = jest
    .fn()
    .mockImplementation(async (session, mode) => ({ session, mode }));
  NativeModules.OrotTestControl = { rotationGeometryCommand };
  await render(<RotationGeometryRequest session="transition-session" />);
  for (const mode of ['start', 'request', 'read']) {
    await fireEvent.press(screen.getByTestId('rotation-transition-request'));
    await waitFor(() =>
      expect(
        JSON.parse(
          screen.getByTestId('rotation-transition-request').props
            .accessibilityLabel,
        ).mode,
      ).toBe(mode),
    );
  }
  expect(rotationGeometryCommand.mock.calls.map(call => call[1])).toEqual([
    'start',
    'request',
    'read',
  ]);
});
