import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
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

test('uses the parent safe content width for open Duo and falls back inside an active division', async () => {
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
        screen.getByTestId('rag-conversation-columns-primary').props.style,
      ).width;
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: { ...openGeometry, hasHinge: true },
    });
    expect(primaryWidth()).toBe(867);
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width: primaryWidth() } },
    });
    expect(screen.getByTestId('conversation-activity-pane')).toBeTruthy();
    const input = screen.getByTestId('rag-conversation-input');
    await fireEvent.changeText(input, '보존되는 합성 초안');
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: { ...dividedGeometry, hasHinge: true },
    });
    expect(primaryWidth()).toBeLessThan(760);
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width: primaryWidth() } },
    });
    expect(screen.queryByTestId('conversation-activity-pane')).toBeNull();
    expect(screen.getByTestId('rag-conversation-input')).toBe(input);
    expect(input.props.value).toBe('보존되는 합성 초안');
    const hidden = screen.getByTestId('conversation-activity-pane', {
      includeHiddenElements: true,
    });
    expect(hidden.props.accessibilityElementsHidden).toBe(true);
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
  } finally {
    measurement.mockRestore();
    dimensions.mockRestore();
  }
});
