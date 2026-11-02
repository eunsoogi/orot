import { fireEvent, screen } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';

/** Exercises the direct control or its native action-sheet choice when it overflows. */
export async function pressPageAction(
  overflow: Parameters<typeof fireEvent.press>[0] | null,
  label: string,
) {
  const direct = screen.queryByRole('button', { name: label });
  if (direct) {
    if (direct.props.accessibilityState?.disabled || direct.props.disabled)
      throw new Error(`Disabled page action: ${label}`);
    await fireEvent.press(direct);
    return;
  }
  if (!overflow) throw new Error(`Missing page action: ${label}`);
  const sheet = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((options, select) => {
      const index = options.options.indexOf(label);
      if (index < 0) throw new Error(`Missing overflow action: ${label}`);
      if (options.disabledButtonIndices?.includes(index))
        throw new Error(`Disabled overflow action: ${label}`);
      select(index);
    });
  try {
    await fireEvent.press(overflow);
  } finally {
    sheet.mockRestore();
  }
}
