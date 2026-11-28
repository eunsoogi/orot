import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { RecordsHeading, RecordsRouteEntries } from '../RecordsRouteEntries';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
const original = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
afterEach(() => Dimensions.set(original));

test.each([1, 1.5, 3.571])(
  'keeps the title-adjacent recording action usable at scale %s',
  async fontScale => {
    Dimensions.set({
      window: { ...original.window, width: 393, fontScale },
      screen: { ...original.screen, width: 393, fontScale },
    });
    const onOpenRecording = jest.fn();
    await render(<RecordsHeading onOpenRecording={onOpenRecording} />);
    expect(screen.getByTestId('records-title')).toHaveStyle({
      fontSize: 34,
      fontWeight: '700',
    });
    const action = screen.getByRole('button', { name: '새 상담 녹음' });
    expect(action).toHaveStyle({
      minHeight: 44,
      minWidth: 44,
      paddingHorizontal: 12,
    });
    expect(screen.getByTestId('records-capture-actions')).toHaveStyle({
      marginStart: 'auto',
    });
    const glass = screen.getByTestId('recording-capture-glass');
    expect(glass.type).toBe('ComposerGlassView');
    expect(glass.props.pointerEvents).toBe('none');
    expect(screen.getByTestId('records-hub-header')).toHaveStyle({
      flexWrap: 'wrap',
      flexDirection: 'row',
      gap: 12,
    });
    expect(screen.getByTestId('recording-capture-content')).toHaveStyle({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    });
    const title = screen.getByText('새 상담 녹음');
    expect(title).toHaveStyle({ flexShrink: 1 });
    expect(title.props.allowFontScaling).not.toBe(false);
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.queryByTestId('symptoms-open')).toBeNull();
    await fireEvent.press(action);
    expect(onOpenRecording).toHaveBeenCalledTimes(1);
  },
);

test.each([
  [900, 1, '31%'],
  [390, 2, '100%'],
] as const)(
  'reflows the material directory at width %s and text scale %s',
  async (width, fontScale, tileWidth) => {
    Dimensions.set({
      window: { ...original.window, width, fontScale },
      screen: { ...original.screen, width, fontScale },
    });
    await render(
      <RecordsRouteEntries
        onOpenSavedRecordings={jest.fn()}
        onOpenHealthLibrary={jest.fn()}
        onOpenSchedule={jest.fn()}
        onOpenManualHistory={jest.fn()}
        onOpenGeneratedReports={jest.fn()}
        medicalDocumentOpening={false}
        medicalDocumentDisabled={false}
        onImportMedicalDocument={jest.fn()}
        onImportMedicalPhoto={jest.fn()}
      />,
    );
    expect(
      screen.getByText('대화에서 생성한 자료').props.numberOfLines,
    ).toBeUndefined();
    expect(screen.getByTestId('records-open-generated-reports')).toHaveStyle({
      width: tileWidth,
      minHeight: 56,
    });
    expect(screen.queryByTestId('saved-memory-browser')).toBeNull();
    expect(screen.queryByTestId('generated-report-browser')).toBeNull();
  },
);
