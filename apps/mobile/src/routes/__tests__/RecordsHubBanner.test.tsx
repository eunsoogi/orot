import { render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { RecordsHubBanner } from '../RecordsHubBanner';

afterEach(() => jest.restoreAllMocks());

test('keeps the requested decorative banner and subtitle at ordinary text size', async () => {
  jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  await render(<RecordsHubBanner />);
  expect(screen.getByTestId('records-title')).toBeVisible();
  expect(screen.getByTestId('records-subtitle')).toBeVisible();
});

test('makes the fixed heading compact without capping accessible text scaling', async () => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 3.12,
  });
  await render(<RecordsHubBanner />);
  const title = screen.getByTestId('records-title');
  expect(ReactNative.StyleSheet.flatten(title.props.style).fontSize).toBe(24);
  expect(title.props.maxFontSizeMultiplier).toBeUndefined();
  expect(screen.queryByTestId('records-subtitle')).toBeNull();
});
