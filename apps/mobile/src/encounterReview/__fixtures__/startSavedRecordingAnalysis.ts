import { fireEvent, screen } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';

/** Activate the first analysis action through the saved recording's native menu. */
export async function startSavedRecordingAnalysis() {
  const sheet = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_options, choose) => choose(0));
  try {
    await fireEvent.press(await screen.findByTestId('recording-analysis-menu'));
    expect(sheet).toHaveBeenCalledTimes(1);
  } finally {
    sheet.mockRestore();
  }
}
