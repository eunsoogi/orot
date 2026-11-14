import { fireEvent, render, screen } from '@testing-library/react-native';
import TranscriptCorrectionEditor from '../TranscriptCorrectionEditor';
import {
  observeTranscriptTap,
  registerTranscriptTapObserver,
} from '../transcriptTapObservation';

test('synthetic observation distinguishes touch, blur and one save callback without editor text', async () => {
  const events: string[] = [];
  const release = registerTranscriptTapObserver(event => events.push(event));
  const onSave = jest.fn(async () => undefined);
  const view = await render(
    <TranscriptCorrectionEditor
      ordinal={0}
      busy={false}
      draft="Synthetic private text"
      onChange={jest.fn()}
      onSave={onSave}
      onCancel={jest.fn()}
    />,
  );
  await fireEvent(screen.getByTestId('transcript-editor-0'), 'touchStart');
  await fireEvent(screen.getByTestId('transcript-input-0'), 'blur');
  await fireEvent.press(screen.getByTestId('transcript-save-0'));
  await fireEvent(screen.getByTestId('transcript-editor-0'), 'touchEnd');
  expect(events).toEqual([
    'editor-touch-start',
    'input-blur',
    'save-press',
    'editor-touch-end',
  ]);
  expect(onSave).toHaveBeenCalledTimes(1);
  release();
  observeTranscriptTap('save-press');
  expect(events).toHaveLength(4);
  await view.unmount();
});

test('throwing diagnostic cannot change action execution', () => {
  const release = registerTranscriptTapObserver(() => {
    throw new Error('diagnostic');
  });
  expect(() => observeTranscriptTap('save-enter')).not.toThrow();
  release();
});
