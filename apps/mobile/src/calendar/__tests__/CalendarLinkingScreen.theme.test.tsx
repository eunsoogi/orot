import { render, screen } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';
import { appThemeForScheme } from '../../design/tokens';
import { t } from '../../i18n';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import { bridge, repository } from '../calendarTestUtils';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

afterEach(() => jest.mocked(useColorScheme).mockReturnValue('light'));

test.each(['light', 'dark'] as const)(
  'uses the shared %s palette for the Calendar route background and copy',
  async scheme => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const colors = appThemeForScheme(scheme).colors;
    await render(
      <CalendarLinkingScreen
        bridge={bridge()}
        repository={repository(async () => [])}
      />,
    );

    const page = screen.getByTestId('calendar-screen');
    expect(
      StyleSheet.flatten(page.props.contentContainerStyle).backgroundColor,
    ).toBe(colors.canvas);
    const title = screen.getByTestId('calendar-title');
    expect(StyleSheet.flatten(title.props.style).color).toBe(colors.text);
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.allowFontScaling).not.toBe(false);
    expect(title.props.numberOfLines).toBeUndefined();
    for (const key of [
      'calendar.description',
      'calendar.permissionExplanation',
    ] as const) {
      const copy = screen.getByText(t(key));
      expect(StyleSheet.flatten(copy.props.style).color).toBe(colors.textMuted);
      expect(copy.props.allowFontScaling).not.toBe(false);
    }
  },
);
