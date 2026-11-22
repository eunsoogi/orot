import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColorPalettes } from '../../layout/appColors';
import { styles as conversationStyles } from '../ConversationScreen.styles';
import { ConversationVoiceEndMarker } from '../ConversationVoiceEndMarker';

test.each([
  [134, '2분 14초'],
  [0, '0분 0초'],
  [3610, '60분 10초'],
] as const)(
  'draws an action-free voice receipt for %s seconds',
  async (durationSeconds, duration) => {
    await render(
      <ConversationVoiceEndMarker
        task={{ kind: 'voice_end', durationSeconds }}
      />,
    );
    expect(screen.getByText('음성 대화 종료')).toBeTruthy();
    expect(screen.getByText(duration)).toBeTruthy();
    expect(
      screen.getByTestId('conversation-voice-end-marker').props
        .accessibilityLabel,
    ).toBe(`음성 대화 종료, ${duration}`);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  },
);

const palette = (color: unknown) =>
  (color as { dynamic: { light: string; dark: string } }).dynamic;

function contrast(a: string, b: string) {
  const luminance = (hex: string) =>
    [0.2126, 0.7152, 0.0722].reduce((value, weight, i) => {
      const channel = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return (
        value +
        weight *
          (channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('light mode separates the receipt from nearby surfaces without changing its dark colors or text', async () => {
  await render(
    <ConversationVoiceEndMarker
      task={{ kind: 'voice_end', durationSeconds: 134 }}
    />,
  );
  const card = screen.getByTestId('conversation-voice-end-marker');
  const cardStyle = StyleSheet.flatten(card.props.style);
  const fill = palette(cardStyle.backgroundColor);
  expect(fill).toMatchObject({ dark: '#252525' });
  const adjacentSurfaces = [
    palette(conversationStyles.screen.backgroundColor).light,
    palette(conversationStyles.assistantBody.backgroundColor).light,
  ];
  for (const nearby of adjacentSurfaces)
    expect(contrast(fill.light, nearby)).toBeGreaterThan(1.08);
  const outline = screen.getByTestId('conversation-voice-end-outline', {
    includeHiddenElements: true,
  });
  const outlineStyle = StyleSheet.flatten(outline.props.style);
  const stroke = palette(outlineStyle.borderColor);
  expect(outlineStyle).toMatchObject({ position: 'absolute', borderWidth: 1 });
  expect(outline.props).toMatchObject({
    accessible: false,
    accessibilityElementsHidden: true,
    pointerEvents: 'none',
  });
  expect(stroke.dark).toBe('transparent');
  for (const nearby of adjacentSurfaces)
    expect(contrast(stroke.light, nearby)).toBeGreaterThan(1.5);
  const title = StyleSheet.flatten(
    screen.getByText('음성 대화 종료').props.style,
  );
  const duration = StyleSheet.flatten(screen.getByText('2분 14초').props.style);
  expect(cardStyle).toMatchObject({ padding: 16 });
  expect(title).toMatchObject({ fontSize: 16, fontWeight: '600' });
  expect(duration).toMatchObject({ fontSize: 13 });
  for (const [style, token] of [
    [title, 'text'],
    [duration, 'secondary'],
  ] as const) {
    for (const mode of ['light', 'dark'] as const) {
      expect(palette(style.color)[mode]).toBe(appColorPalettes[mode][token]);
      expect(
        contrast(palette(style.color)[mode], fill[mode]),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
