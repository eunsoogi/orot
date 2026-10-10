import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AppText } from '../AppText';
import { appColors } from '../appColors';

test('uses the appearance-aware text token by default and honors explicit overrides', async () => {
  await render(
    <>
      <AppText>본문</AppText>
      <AppText style={{ color: '#ff00ff' }}>강조</AppText>
    </>,
  );

  // React Native's default Text color is fixed black, so app copy supplies the system-aware token.
  expect(StyleSheet.flatten(screen.getByText('본문').props.style).color).toBe(
    appColors.text,
  );
  expect(StyleSheet.flatten(screen.getByText('강조').props.style).color).toBe(
    '#ff00ff',
  );
});
