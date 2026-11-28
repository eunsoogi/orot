import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { AppText } from '../AppText';
import { PageHeading } from '../PageHeading';
import { pageHeadingStyles } from '../pageHeadingPresentation';

const text = '개인정보 처리 방침';
const originalStyle = { marginStart: -4 };

test('matches original native text at every nondefault size and switches reactively', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'ios');
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions');
  const size = (fontScale: number) => {
    dimensions.mockReturnValue({
      width: 466,
      height: 678,
      scale: 3,
      fontScale,
    });
  };
  try {
    size(1);
    const mounted = await render(
      <>
        <AppText
          accessibilityRole="header"
          style={[pageHeadingStyles.title, originalStyle]}
          testID="stock"
        >
          {text}
        </AppText>
        <PageHeading style={originalStyle} testID="title">
          {text}
        </PageHeading>
      </>,
    );
    const original = () =>
      StyleSheet.flatten(screen.getByTestId('stock').props.style);
    const current = () =>
      StyleSheet.flatten(screen.getByTestId('title').props.style);
    expect(current()).toEqual({ ...original(), lineHeight: 42 });

    for (const fontScale of [0.824, 1.118, 3.571, NaN, 1]) {
      size(fontScale);
      await mounted.rerender(
        <>
          <AppText
            accessibilityRole="header"
            style={[pageHeadingStyles.title, originalStyle]}
            testID="stock"
          >
            {text}
          </AppText>
          <PageHeading style={originalStyle} testID="title">
            {text}
          </PageHeading>
        </>,
      );
      expect(current()).toEqual(
        fontScale === 1 ? { ...original(), lineHeight: 42 } : original(),
      );
      expect(screen.getByTestId('title')).toHaveProp(
        'accessibilityRole',
        'header',
      );
      expect(screen.getByTestId('title')).not.toHaveProp('numberOfLines');
      expect(screen.getByTestId('title')).not.toHaveProp(
        'maxFontSizeMultiplier',
      );
    }
  } finally {
    dimensions.mockRestore();
    os.restore();
  }
});

test('keeps the original heading on Android even at default scale', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const dimensions = jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 466, height: 678, scale: 3, fontScale: 1 });
  try {
    await render(<PageHeading testID="title">{text}</PageHeading>);
    expect(screen.getByTestId('title')).toHaveStyle(pageHeadingStyles.title);
    expect(
      StyleSheet.flatten(screen.getByTestId('title').props.style),
    ).not.toHaveProperty('lineHeight');
  } finally {
    dimensions.mockRestore();
    os.restore();
  }
});
