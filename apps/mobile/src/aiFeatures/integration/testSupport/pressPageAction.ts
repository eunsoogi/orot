import { fireEvent } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';

/** Exercises the same native action-sheet choice used when a page action overflows. */
export async function pressPageAction(
  overflow: Parameters<typeof fireEvent.press>[0],
  label: string,
) {
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
