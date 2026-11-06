import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { RecordsRouteEntries } from '../RecordsRouteEntries';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
const original = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
afterEach(() => Dimensions.set(original));

test.each([1, 1.5, 3.571])(
  'retains recording at text scale %s without a journal action',
  async fontScale => {
    Dimensions.set({
      window: { ...original.window, width: 393, fontScale },
      screen: { ...original.screen, width: 393, fontScale },
    });
    const onOpenRecording = jest.fn();
    await render(
      <RecordsRouteEntries
        onOpenRecording={onOpenRecording}
        onOpenSavedRecordings={jest.fn()}
        onOpenHealthLibrary={jest.fn()}
        onOpenManualHistory={jest.fn()}
        medicalDocumentOpening={false}
        medicalDocumentDisabled={false}
        onImportMedicalDocument={jest.fn()}
        onImportMedicalPhoto={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('symptoms-open')).toBeNull();
    // This protects the row contract; actual wrapping and hit targets need native geometry.
    expect(screen.getByTestId('recording-capture-content')).toHaveStyle({
      flexDirection: 'row',
      alignItems: 'center',
    });
    expect(screen.getByText('새 상담 녹음')).toHaveStyle({ flexShrink: 1 });
    expect(screen.getByText('새 상담 녹음').props).toEqual(
      expect.not.objectContaining({ allowFontScaling: false }),
    );
    expect(
      screen.getByText('새 상담 녹음').props.numberOfLines,
    ).toBeUndefined();
    expect(
      screen.getByText('새 상담 녹음').props.maxFontSizeMultiplier,
    ).toBeUndefined();
    await fireEvent.press(screen.getByRole('button', { name: '새 상담 녹음' }));
    expect(onOpenRecording).toHaveBeenCalledTimes(1);
  },
);
