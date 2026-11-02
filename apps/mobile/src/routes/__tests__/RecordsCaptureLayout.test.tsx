import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { RecordsRouteEntries } from '../RecordsRouteEntries';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};

afterEach(() => Dimensions.set(originalDimensions));

test.each([
  { fontScale: 1, direction: 'row' },
  { fontScale: 1.5, direction: 'column' },
  { fontScale: 3.571, direction: 'column' },
])(
  'keeps both capture actions usable at text scale $fontScale',
  async ({ fontScale, direction }) => {
    Dimensions.set({
      window: { ...originalDimensions.window, width: 393, fontScale },
      screen: { ...originalDimensions.screen, width: 393, fontScale },
    });
    const onOpenRecording = jest.fn();
    const onOpenSymptoms = jest.fn();
    await render(
      <RecordsRouteEntries
        onOpenRecording={onOpenRecording}
        onOpenSymptoms={onOpenSymptoms}
        onOpenSavedRecordings={jest.fn()}
        onOpenHealthLibrary={jest.fn()}
        onOpenManualHistory={jest.fn()}
        medicalDocumentOpening={false}
        medicalDocumentDisabled={false}
        onImportMedicalDocument={jest.fn()}
      />,
    );

    const recording = screen.getByRole('button', { name: '새 상담 녹음' });
    const symptoms = screen.getByRole('button', { name: '증상 일지' });
    expect(
      StyleSheet.flatten(
        screen.getByTestId('records-capture-actions').props.style,
      ).flexDirection,
    ).toBe(direction);
    expect(StyleSheet.flatten(recording.props.style)).toEqual(
      StyleSheet.flatten(symptoms.props.style),
    );
    await fireEvent.press(recording);
    await fireEvent.press(symptoms);
    expect(onOpenRecording).toHaveBeenCalledTimes(1);
    expect(onOpenSymptoms).toHaveBeenCalledTimes(1);
  },
);

test('matches peer heights to measured content and allows them to shrink', async () => {
  Dimensions.set({
    window: { ...originalDimensions.window, width: 320, fontScale: 3.571 },
    screen: { ...originalDimensions.screen, width: 320, fontScale: 3.571 },
  });
  await render(
    <RecordsRouteEntries
      onOpenRecording={jest.fn()}
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      medicalDocumentOpening={false}
      medicalDocumentDisabled={false}
      onImportMedicalDocument={jest.fn()}
    />,
  );
  const measure = async (id: string, height: number) =>
    fireEvent(screen.getByTestId(id), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 280, height } },
    });
  await measure('recording-capture-content', 180);
  await measure('symptom-capture-content', 110);
  for (const id of ['records-new-recording', 'symptoms-open']) {
    expect(
      StyleSheet.flatten(screen.getByTestId(id).props.style).minHeight,
    ).toBe(204);
  }
  await measure('recording-capture-content', 90);
  for (const id of ['records-new-recording', 'symptoms-open']) {
    expect(
      StyleSheet.flatten(screen.getByTestId(id).props.style).minHeight,
    ).toBe(134);
  }
  await act(() => {
    Dimensions.set({
      window: { ...originalDimensions.window, width: 390, fontScale: 1.5 },
      screen: { ...originalDimensions.screen, width: 390, fontScale: 1.5 },
    });
  });
  await measure('recording-capture-content', 80);
  await measure('symptom-capture-content', 70);
  for (const id of ['records-new-recording', 'symptoms-open']) {
    expect(
      StyleSheet.flatten(screen.getByTestId(id).props.style).minHeight,
    ).toBe(104);
  }
});
