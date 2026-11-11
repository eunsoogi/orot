import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { hubSpacing } from '../../layout/hubSpacing';
import { RecordsRouteEntries } from '../RecordsRouteEntries';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
const original = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
afterEach(() => Dimensions.set(original));

test('keeps the recording entry in the Records spacing rhythm', async () => {
  await render(
    <RecordsRouteEntries
      onOpenRecording={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      medicalDocumentOpening={false}
      medicalDocumentDisabled={false}
      onImportMedicalDocument={jest.fn()}
      onImportMedicalPhoto={jest.fn()}
    />,
  );

  const captureActions = screen.getByTestId('records-capture-actions');
  const recordingAction = screen.getByRole('button', { name: '새 상담 녹음' });

  // The route container already adds one 16pt item gap before the action group.
  expect(captureActions).not.toHaveStyle({ marginTop: 4 });
  expect(recordingAction).toHaveStyle({
    paddingHorizontal: hubSpacing.item,
    paddingVertical: hubSpacing.item,
  });
  // My Data rows use a 12pt space between their icon and title.
  expect(screen.getByTestId('recording-capture-content')).toHaveStyle({
    gap: 12,
  });
});

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
