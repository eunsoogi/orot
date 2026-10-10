import { appColors } from '../../layout/appColors';
import { recordingLibraryStyles } from '../RecordingLibraryPanel.styles';
import { recordingControlStyles } from '../RecordingControls.styles';

describe('recording screens use shared appearance tokens', () => {
  it('keeps recording copy and destructive states readable in dark mode', () => {
    expect(recordingControlStyles.title.color).toBe(appColors.text);
    expect(recordingControlStyles.checkbox.color).toBe(appColors.text);
    expect(recordingControlStyles.status.color).toBe(appColors.text);
    expect(recordingControlStyles.copy.color).toBe(appColors.secondary);
    expect(recordingControlStyles.duration.color).toBe(appColors.secondary);
    expect(recordingControlStyles.error.color).toBe(appColors.danger);
    expect(recordingLibraryStyles.title.color).toBe(appColors.text);
    expect(recordingLibraryStyles.error.color).toBe(appColors.danger);
    expect(recordingLibraryStyles.confirmationConfirm.backgroundColor).toBe(
      appColors.dangerAction,
    );
    expect(recordingLibraryStyles.confirmationConfirmText.color).toBe(
      appColors.onDanger,
    );
  });
});

export {};
