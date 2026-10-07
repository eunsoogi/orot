import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  DesignButton,
  DesignCard,
  DesignIcon,
  DesignInput,
  DesignText,
} from '..';
import { appThemeForScheme, designTokens } from '../tokens';

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  if (!channels || channels.length !== 3)
    throw new Error('Expected an RGB color');
  const linear = channels.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

describe('shared design system', () => {
  it.each(['light', 'dark'] as const)(
    'keeps semantic text colors readable in %s appearance',
    scheme => {
      const theme = appThemeForScheme(scheme);
      const pairs = [
        [theme.colors.text, theme.colors.canvas],
        [theme.colors.text, theme.colors.surface],
        [theme.colors.textMuted, theme.colors.surface],
        [theme.colors.accent, theme.colors.surface],
        [theme.colors.onAccent, theme.colors.accent],
        [theme.colors.accentText, theme.colors.accentSubtle],
        [theme.colors.warning, theme.colors.warningSurface],
        [theme.colors.danger, theme.colors.dangerSurface],
      ];

      for (const [foreground, background] of pairs) {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

  it('uses the light palette until the system reports an appearance', () => {
    expect(appThemeForScheme(null).scheme).toBe('light');
    expect(appThemeForScheme('dark').colors.canvas).not.toBe(
      appThemeForScheme('light').colors.canvas,
    );
  });

  it('keeps text scalable and cards on a theme surface', async () => {
    const screen = await render(
      <DesignCard testID="design-card">
        <DesignText testID="design-copy" variant="body">
          오늘의 기록
        </DesignText>
      </DesignCard>,
    );
    const cardStyle = StyleSheet.flatten(
      screen.getByTestId('design-card').props.style,
    );

    expect(screen.getByTestId('design-copy').props.allowFontScaling).toBe(true);
    expect(cardStyle.borderRadius).toBe(designTokens.radii.card);
    expect(cardStyle.backgroundColor).toBe(
      appThemeForScheme('light').colors.surface,
    );
  });

  it('gives every button an accessible label and at least a 44pt target', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <DesignButton
        accessibilityLabel="다음 달"
        icon="chevron-right"
        label=""
        testID="design-next"
        variant="icon"
        onPress={onPress}
      />,
    );
    const button = screen.getByTestId('design-next');
    const resolvedStyle =
      typeof button.props.style === 'function'
        ? button.props.style({ pressed: false })
        : button.props.style;
    const buttonStyle = StyleSheet.flatten(resolvedStyle);

    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('다음 달');
    expect(buttonStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(buttonStyle.minWidth).toBeGreaterThanOrEqual(44);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('preserves caller accessibility state while disabled matches interaction', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <DesignButton
        accessibilityState={{
          selected: true,
          busy: true,
          expanded: true,
          disabled: false,
        }}
        disabled
        label="저장"
        onPress={onPress}
        testID="stateful-button"
      />,
    );
    const button = screen.getByTestId('stateful-button');
    expect(button.props.accessibilityState).toEqual({
      selected: true,
      busy: true,
      expanded: true,
      disabled: true,
    });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('labels input errors and keeps Dynamic Type enabled', async () => {
    const screen = await render(
      <DesignInput
        errorText="날짜를 입력해 주세요."
        label="방문 날짜"
        testID="visit-date"
        value=""
        onChangeText={jest.fn()}
      />,
    );
    const input = screen.getByTestId('visit-date');

    expect(input.props.accessibilityLabel).toBe('방문 날짜');
    expect(input.props.accessibilityHint).toBe('날짜를 입력해 주세요.');
    expect(input.props.allowFontScaling).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(
      '날짜를 입력해 주세요.',
    );

    const errorStyle = StyleSheet.flatten(input.props.style);
    expect(errorStyle.borderColor).toBe(
      appThemeForScheme('light').colors.danger,
    );
    expect(errorStyle.borderWidth).toBe(1);

    await fireEvent(input, 'focus');
    const focusedErrorStyle = StyleSheet.flatten(
      screen.getByTestId('visit-date').props.style,
    );
    expect(focusedErrorStyle.borderColor).toBe(
      appThemeForScheme('light').colors.danger,
    );
    expect(focusedErrorStyle.borderWidth).toBe(2);
  });

  it('highlights focused inputs and restores their border when focus leaves', async () => {
    const onBlur = jest.fn();
    const onFocus = jest.fn();
    const screen = await render(
      <DesignInput
        label="검색어"
        onBlur={onBlur}
        onFocus={onFocus}
        testID="focused-input"
        value=""
        onChangeText={jest.fn()}
      />,
    );
    const input = screen.getByTestId('focused-input');

    expect(StyleSheet.flatten(input.props.style).borderColor).toBe(
      appThemeForScheme('light').colors.border,
    );
    await fireEvent(input, 'focus');
    const focusedStyle = StyleSheet.flatten(
      screen.getByTestId('focused-input').props.style,
    );
    expect(focusedStyle.borderColor).toBe(
      appThemeForScheme('light').colors.accent,
    );
    expect(focusedStyle.borderWidth).toBe(2);
    expect(onFocus).toHaveBeenCalledTimes(1);

    await fireEvent(input, 'blur');
    const restingStyle = StyleSheet.flatten(
      screen.getByTestId('focused-input').props.style,
    );
    expect(restingStyle.borderColor).toBe(
      appThemeForScheme('light').colors.border,
    );
    expect(restingStyle.borderWidth).toBe(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('can expose an icon name to assistive technology when it carries meaning', async () => {
    const screen = await render(
      <DesignIcon accessibilityLabel="다음 일정" name="next-visit" />,
    );

    expect(screen.getByLabelText('다음 일정').props.accessibilityRole).toBe(
      'image',
    );
  });
});
