import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import * as Native from 'react-native';
import { ConversationEdgeGradient } from '../ConversationEdgeGradient';
import { appColorPalettes } from '../appColors';

// Inspect the SVG contract, not native raster output, through passive host fixtures.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const host = (name: string) => (props: object) =>
    React.createElement(name, { ...props, testID: name });
  return {
    __esModule: true,
    default: host('Svg'),
    Defs: host('Defs'),
    LinearGradient: host('Gradient'),
    Stop: host('Stop'),
    Rect: host('Rect'),
  };
});

afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)(
  'shares stronger resolved %s stops and mirrors the composer fade',
  async scheme => {
    jest.spyOn(Native, 'useColorScheme').mockReturnValue(scheme);
    jest
      .spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled')
      .mockResolvedValue(false);
    const view = await render(
      <ConversationEdgeGradient edge="top" testID="edge" />,
    );
    const gradient = () =>
      view.getByTestId('Gradient', { includeHiddenElements: true });
    expect(gradient().props).toMatchObject({ y1: '0', y2: '1' });
    const stops = () =>
      view
        .getAllByTestId('Stop', { includeHiddenElements: true })
        .map(stop => ({
          offset: stop.props.offset,
          opacity: stop.props.stopOpacity,
          color: stop.props.stopColor,
        }));
    const expected = [
      {
        offset: '0',
        opacity: 0.98,
        color: appColorPalettes[scheme].background,
      },
      {
        offset: '0.6',
        opacity: 0.78,
        color: appColorPalettes[scheme].background,
      },
      { offset: '1', opacity: 0, color: appColorPalettes[scheme].background },
    ];
    expect(stops()).toEqual(expected);
    await view.rerender(
      <ConversationEdgeGradient edge="bottom" testID="edge" fadeOverlap={16} />,
    );
    expect(stops()).toEqual(expected);
    expect(gradient().props).toMatchObject({ y1: '1', y2: '0' });
    const backdrop = view.getByTestId('edge', { includeHiddenElements: true });
    expect(backdrop.props.pointerEvents).toBe('none');
    expect(backdrop.props.accessibilityElementsHidden).toBe(true);
    expect(StyleSheet.flatten(backdrop.props.style)).toMatchObject({
      position: 'absolute',
      top: -16,
    });
    expect(StyleSheet.flatten(backdrop.props.style).opacity).toBeUndefined();
  },
);

test('does not obscure history when reduced transparency changes before the initial query resolves', async () => {
  let resolve!: (value: boolean) => void;
  let change!: (value: boolean) => void;
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((_name, callback) => {
      change = callback as (value: boolean) => void;
      return { remove };
    });
  const view = await render(
    <ConversationEdgeGradient edge="bottom" testID="edge" fadeOverlap={16} />,
  );
  await act(async () => {
    change(true);
    resolve(false);
  });
  expect(
    view.getByTestId('edge-opaque', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    StyleSheet.flatten(
      view.getByTestId('edge', { includeHiddenElements: true }).props.style,
    ).top,
  ).toBe(0);
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
