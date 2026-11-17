import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { VoiceTranscriptViewport } from '../VoiceTranscriptViewport';

const lines = [
  { id: 'synthetic', role: 'user' as const, text: 'Synthetic speech' },
];
const viewport = () => screen.getByTestId('voice-transcript-scroll');
const scroll = (y: number, height = 100, content = 300) =>
  fireEvent.scroll(viewport(), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 300, height: content },
      layoutMeasurement: { width: 300, height },
    },
  });
afterEach(() => jest.restoreAllMocks());

test('new speech geometry does not turn a followed transcript into reader scroll-back', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  end.mockClear();
  await scroll(200, 100, 500);
  await fireEvent(viewport(), 'contentSizeChange', 300, 500);
  expect(end).toHaveBeenCalledWith({ animated: false });
});

test('a viewport shrinking without a reader gesture keeps following', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  end.mockClear();
  await scroll(200, 50);
  await fireEvent(viewport(), 'layout', {
    nativeEvent: { layout: { height: 50 } },
  });
  expect(end).toHaveBeenCalledWith({ animated: false });
});

test('real drag during reflow pauses following until the reader reaches the end', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  await fireEvent(viewport(), 'scrollBeginDrag');
  await scroll(100, 100, 500);
  await fireEvent(viewport(), 'scrollEndDrag');
  end.mockClear();
  await fireEvent(viewport(), 'contentSizeChange', 300, 500);
  expect(end).not.toHaveBeenCalled();
  await scroll(400, 100, 500);
  await fireEvent(viewport(), 'contentSizeChange', 300, 600);
  expect(end).toHaveBeenCalledWith({ animated: false });
});

test('unchanged-geometry accessibility scroll-back still pauses following', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  await scroll(50);
  end.mockClear();
  await fireEvent(viewport(), 'contentSizeChange', 300, 500);
  expect(end).not.toHaveBeenCalled();
});

test('reader position survives passive reflow and clearing starts a fresh followed transcript', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const view = await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  await scroll(30);
  end.mockClear();
  await scroll(30, 80, 500);
  await fireEvent(viewport(), 'layout', {
    nativeEvent: { layout: { height: 80 } },
  });
  await fireEvent(viewport(), 'contentSizeChange', 300, 500);
  expect(end).not.toHaveBeenCalled();
  await view.rerender(<VoiceTranscriptViewport lines={[]} />);
  await view.rerender(<VoiceTranscriptViewport lines={lines} />);
  await fireEvent(viewport(), 'contentSizeChange', 300, 300);
  expect(end).toHaveBeenCalledWith({ animated: false });
});

test('momentum scrolling during content growth remains reader owned', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  await fireEvent(viewport(), 'momentumScrollBegin');
  await scroll(200, 100, 500);
  await fireEvent(viewport(), 'momentumScrollEnd');
  end.mockClear();
  await fireEvent(viewport(), 'contentSizeChange', 300, 500);
  expect(end).not.toHaveBeenCalled();
});

test('a drag owns layout changes before its first offset event', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(200);
  await fireEvent(viewport(), 'scrollBeginDrag');
  end.mockClear();
  await fireEvent(viewport(), 'contentSizeChange', 300, 500);
  await fireEvent(viewport(), 'layout', {
    nativeEvent: { layout: { height: 80 } },
  });
  expect(end).not.toHaveBeenCalled();
});

test('content shrink clamping an earlier reader position does not resume following', async () => {
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<VoiceTranscriptViewport lines={lines} />);
  await scroll(100, 100, 500);
  end.mockClear();
  await scroll(20, 100, 120);
  await fireEvent(viewport(), 'contentSizeChange', 300, 120);
  expect(end).not.toHaveBeenCalled();
});
