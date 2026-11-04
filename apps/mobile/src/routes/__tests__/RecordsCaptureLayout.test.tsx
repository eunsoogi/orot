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
    await fireEvent.press(screen.getByRole('button', { name: '새 상담 녹음' }));
    expect(onOpenRecording).toHaveBeenCalledTimes(1);
  },
);
