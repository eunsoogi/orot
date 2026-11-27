import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import {
  openGeometry,
  dividedGeometry,
} from '../../navigation/__fixtures__/navigationOpenGeometry';
import { ConversationScreen } from '../ConversationScreen';

// Replay geometry-only native evidence. This does not claim actual UIKit rendering.
const measurable = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

test('uses the parent safe content width for open Duo and splits safely across an active division', async () => {
  const dimensions = jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 951, height: 669, scale: 3, fontScale: 1 });
  const measurement = jest
    .spyOn(measurable.prototype, 'measureInWindow')
    .mockImplementation(callback => callback(0, 0, 867, 635));
  try {
    await render(
      <NavigationGeometryProvider>
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={jest.fn()}
        />
      </NavigationGeometryProvider>,
    );
    const sensor = screen.getByTestId('navigation-window-geometry-sensor');
    const primaryWidth = () =>
      StyleSheet.flatten(
        screen.getByTestId('conversation-transcript-pane').props.style,
      ).width;
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: { ...openGeometry, hasHinge: true },
    });
    expect(primaryWidth()).toBeCloseTo(867 * 0.68);
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width: primaryWidth() } },
    });
    expect(screen.getByTestId('conversation-activity-pane')).toBeTruthy();
    const input = screen.getByTestId('rag-conversation-input');
    await fireEvent.changeText(input, '보존되는 합성 초안');
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: { ...dividedGeometry, hasHinge: true },
    });
    expect(primaryWidth()).toBeGreaterThanOrEqual(320);
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width: primaryWidth() } },
    });
    expect(screen.getByTestId('conversation-activity-pane')).toBeTruthy();
    expect(screen.getByTestId('rag-conversation-input')).toBe(input);
    expect(input.props.value).toBe('보존되는 합성 초안');
    const hidden = screen.getByTestId('conversation-activity-pane', {
      includeHiddenElements: true,
    });
    expect(hidden.props.accessibilityElementsHidden).toBe(false);
    expect(hidden.props.importantForAccessibility).toBe('auto');
  } finally {
    measurement.mockRestore();
    dimensions.mockRestore();
  }
});

test.each([402, 951])(
  'uses one keyboard ceiling for both overlay and resized Conversation at width %i',
  async width => {
    const dimensions = jest
      .spyOn(require('react-native'), 'useWindowDimensions')
      .mockReturnValue({ width, height: 669, scale: 3, fontScale: 1 });
    let hostHeight = 635;
    const measure = jest
      .spyOn(measurable.prototype, 'measureInWindow')
      .mockImplementation(callback =>
        callback(0, 0, width === 951 ? 867 : width, hostHeight),
      );
    try {
      await render(
        <NavigationGeometryProvider>
          <ConversationScreen
            onBack={jest.fn()}
            onOpenSource={jest.fn()}
            onSend={jest.fn()}
          />
        </NavigationGeometryProvider>,
      );
      const sensor = screen.getByTestId('navigation-window-geometry-sensor');
      const geometry = {
        ...openGeometry,
        windowBounds: { ...openGeometry.windowBounds, width },
        hasHinge: width === 951,
        reservedRegions: width === 951 ? openGeometry.reservedRegions : [],
      };
      const publish = (keyboard?: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) =>
        fireEvent(sensor, 'geometryChange', {
          nativeEvent: { ...geometry, dockedKeyboardFrame: keyboard },
        });
      const bottom = () => {
        const frame = screen.getByTestId('conversation-workspace-host')
          .children[0];
        if (!frame || typeof frame === 'string')
          throw new Error('Missing conversation frame');
        const style = StyleSheet.flatten<ViewStyle>(frame.props.style);
        if (!style) throw new Error('Missing conversation frame style');
        return Number(style.marginTop) + Number(style.height);
      };

      await publish();
      const input = screen.getByTestId('rag-conversation-input');
      const transcript = screen.getByTestId('rag-conversation-history');
      const composer = screen.getByTestId(
        'conversation-floating-composer-overlay',
      );
      await fireEvent.changeText(input, 'retained synthetic draft');
      expect(bottom()).toBeGreaterThan(450);
      const keyboard = { x: 0, y: 450, width, height: 219 };
      // The window-local guide resolved an overlay even when the viewport was unchanged.
      await publish(keyboard);
      expect(bottom()).toBe(450);

      // An independently contracted viewport has already consumed the same overlap.
      hostHeight = 450;
      await publish(keyboard);
      expect(bottom()).toBe(450);

      hostHeight = 635;
      await publish();
      expect(bottom()).toBeGreaterThan(450);
      expect(screen.getByTestId('rag-conversation-input')).toBe(input);
      expect(input.props.value).toBe('retained synthetic draft');
      expect(screen.getByTestId('rag-conversation-history')).toBe(transcript);
      expect(screen.getByTestId('conversation-floating-composer-overlay')).toBe(
        composer,
      );
    } finally {
      measure.mockRestore();
      dimensions.mockRestore();
    }
  },
);
