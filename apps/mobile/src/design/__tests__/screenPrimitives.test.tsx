import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';
import { DesignCheckbox, DesignNotice, DesignScreen, DesignText } from '..';
import { appThemeForScheme } from '../tokens';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

afterEach(() => jest.mocked(useColorScheme).mockReturnValue('light'));

test.each(['light', 'dark'] as const)(
  'keeps the %s screen scrollable, scalable, and on the canvas palette',
  async scheme => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const onBack = jest.fn();
    await render(
      <DesignScreen
        backAction={{ label: '뒤로', onPress: onBack }}
        description="현재 기록을 살펴보세요."
        testID="page"
        title="건강 기록"
      >
        <DesignText>긴 내용도 같은 스크롤 영역에서 읽을 수 있어요.</DesignText>
      </DesignScreen>,
    );
    const page = screen.getByTestId('page');
    expect(StyleSheet.flatten(page.props.style).backgroundColor).toBe(
      appThemeForScheme(scheme).colors.canvas,
    );
    expect(page.props.keyboardShouldPersistTaps).toBe('handled');
    const heading = screen.getByRole('header', { name: '건강 기록' });
    expect(heading.props.allowFontScaling).toBe(true);
    expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
    expect(heading.props.numberOfLines).toBeUndefined();
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  },
);

test('names the whole checkbox target and represents checked state without a glyph label', async () => {
  const onPress = jest.fn();
  const view = await render(
    <DesignCheckbox
      checked={false}
      label="검색어 전송에 동의해요."
      onPress={onPress}
    />,
  );
  const checkbox = screen.getByRole('checkbox', {
    name: '검색어 전송에 동의해요.',
  });
  expect(checkbox).not.toBeChecked();
  const style = StyleSheet.flatten(checkbox.props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  expect(style.minWidth).toBeGreaterThanOrEqual(44);
  await fireEvent.press(checkbox);
  expect(onPress).toHaveBeenCalledTimes(1);
  await view.rerender(
    <DesignCheckbox
      checked
      disabled
      label="검색어 전송에 동의해요."
      onPress={onPress}
    />,
  );
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  await fireEvent.press(screen.getByRole('checkbox'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('announces loading and errors with scalable status text', async () => {
  await render(
    <>
      <DesignNotice busy message="불러오는 중이에요." testID="loading" />
      <DesignNotice
        message="연결을 확인하고 다시 시도해 주세요."
        tone="danger"
      />
    </>,
  );
  expect(screen.getByTestId('loading').props.accessibilityState.busy).toBe(
    true,
  );
  expect(screen.getByTestId('loading').props.accessibilityLiveRegion).toBe(
    'polite',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    '연결을 확인하고 다시 시도해 주세요.',
  );
  expect(screen.getByRole('alert').props.allowFontScaling).toBe(true);
});
