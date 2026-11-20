import { fireEvent, render } from '@testing-library/react-native';
import { registerNavigationTestObserver } from '../../navigation/navigationTestObservation';
import { ConversationHistory } from '../ConversationHistory';
import { registerSyntheticTranscriptScrollTrace } from '../syntheticTranscriptScrollTrace';

test('only the opted-in synthetic sink records scroll order without transcript content', async () => {
  type Observation = Parameters<
    Parameters<typeof registerNavigationTestObserver>[0]
  >[0];
  const events: Observation[] = [];
  const stopNavigation = registerNavigationTestObserver(event =>
    events.push(event),
  );
  const page = (
    <ConversationHistory
      messages={[
        { id: 42, role: 'assistant', content: 'Synthetic answer not logged' },
      ]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
  const send = async (view: Awaited<ReturnType<typeof render>>) => {
    const history = view.getByTestId('rag-conversation-history');
    await fireEvent(history, 'layout', {
      nativeEvent: { layout: { width: 466, height: 400 } },
    });
    await fireEvent(history, 'contentSizeChange', 466, 1200);
    await fireEvent(history, 'scrollBeginDrag');
    await fireEvent.scroll(history, {
      nativeEvent: {
        contentOffset: { x: 0, y: 125 },
        contentSize: { width: 466, height: 1200 },
        layoutMeasurement: { width: 466, height: 400 },
      },
    });
    await fireEvent(history, 'scrollEndDrag');
    await fireEvent(history, 'scrollToTop');
  };
  const observed = () =>
    events.filter(e => e.event === 'synthetic-transcript-scroll');
  try {
    const dark = await render(page);
    await send(dark);
    expect(observed()).toEqual([]);
    await dark.unmount();
    const stopTrace = registerSyntheticTranscriptScrollTrace();
    try {
      const lit = await render(page);
      await send(lit);
    } finally {
      stopTrace();
    }
    const samples = observed();
    expect(samples.map(e => e.boundary)).toEqual([
      'layout',
      'follow-to-end',
      'content-size',
      'follow-to-end',
      'drag-begin',
      'scroll-before',
      'scroll-after',
      'drag-end',
      'status-bar-top-completed',
    ]);
    expect(samples.map(e => e.order)).toEqual(
      samples.map((_, i) => String(i + 1)),
    );
    expect(samples[6]).toEqual({
      event: 'synthetic-transcript-scroll',
      order: '7',
      boundary: 'scroll-after',
      atMs: expect.any(Number),
      width: '466',
      height: '400',
      contentHeight: '1200',
      offset: '125',
      requestedOffset: null,
      followsBottom: false,
      interacting: true,
    });
    expect(JSON.stringify(samples)).not.toContain('Synthetic answer');
  } finally {
    stopNavigation();
  }
});
