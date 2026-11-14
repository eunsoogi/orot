import { fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationRouteScrollView } from '../NavigationRouteScrollView';
import TranscriptCorrectionEditor from '../../transcription/TranscriptCorrectionEditor';

jest.mock('../useNavigationContentInset', () => ({
  useNavigationContentInset: () => ({}),
}));

// Component checks establish props/callbacks, not UIKit responder delivery; the native first-tap oracle remains.
test('default routes retain handled taps, while transcript editing explicitly preserves the first save tap', async () => {
  const onSave = jest.fn(async () => undefined);
  const editor = (
    <TranscriptCorrectionEditor
      ordinal={0}
      busy={false}
      draft="수정한 전사"
      onChange={jest.fn()}
      onSave={onSave}
      onCancel={jest.fn()}
    />
  );
  const view = await render(
    <NavigationRouteScrollView>{editor}</NavigationRouteScrollView>,
  );
  expect(
    screen.getByTestId('navigation-route-scroll').props
      .keyboardShouldPersistTaps,
  ).toBe('handled');
  await view.rerender(
    <NavigationRouteScrollView keyboardShouldPersistTaps="always">
      {editor}
    </NavigationRouteScrollView>,
  );
  expect(
    screen.getByTestId('navigation-route-scroll').props
      .keyboardShouldPersistTaps,
  ).toBe('always');
  await fireEvent.press(screen.getByTestId('transcript-save-0'));
  expect(onSave).toHaveBeenCalledTimes(1);
  await view.unmount();
});
