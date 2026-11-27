import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

type AlertButton = { readonly style?: string; readonly onPress?: () => void };

/** Captures and invokes native confirmation actions without rendering a fake dialog. */
export function mockNativeDeletionAlert() {
  return jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
}

export function pressNativeDeletionButton(
  alert: jest.SpyInstance,
  style: 'cancel' | 'destructive',
): void {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const button = buttons?.find(candidate => candidate.style === style);
  if (!button) {
    throw new Error(`The native deletion alert has no ${style} action.`);
  }
  button.onPress?.();
}

export async function confirmNativeDeletion(
  alert: jest.SpyInstance,
): Promise<void> {
  await act(async () => {
    pressNativeDeletionButton(alert, 'destructive');
    await Promise.resolve();
  });
}

/** VoiceOver's row action requests the same native confirmation as the visible swipe button. */
export async function requestLibraryRowDeletion(sourceId: string) {
  const row = await screen.findByTestId(`recording-details-${sourceId}`);
  await fireEvent(row, 'accessibilityAction', {
    nativeEvent: { actionName: 'delete' },
  });
}
