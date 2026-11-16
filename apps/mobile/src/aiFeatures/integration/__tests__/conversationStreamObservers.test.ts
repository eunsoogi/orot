import { conversationStreamObservers } from '../conversationStreamObservers';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

// Retained request bodies stay suppressed while content-free admitted events reach the UI.
test('retained stream forwards only initial responses, never provisional clinical prose', () => {
  const onTaskStreamEvent = jest.fn();
  const observer = conversationStreamObservers(
    { onTaskStreamEvent },
    true,
    new LocalEvidenceReferenceRegistry(),
    { providerId: 'synthetic', modelId: 'synthetic' },
  );
  const initial = {
    type: 'initial_response' as const,
    callId: 'call',
    text: 'synthetic receipt',
  };
  observer.onTaskStreamEvent?.({ type: 'started' });
  observer.onTaskStreamEvent?.({
    type: 'text_delta',
    text: 'unvalidated synthetic health prose',
  });
  observer.onTaskStreamEvent?.({
    type: 'text_snapshot',
    text: 'unvalidated synthetic health prose',
  });
  observer.onTaskStreamEvent?.(initial);
  expect(onTaskStreamEvent.mock.calls).toEqual([[initial]]);
});

test('retained stream forwards content-free steering availability while withholding partial output', () => {
  const onTaskStreamEvent = jest.fn();
  const observer = conversationStreamObservers(
    { onTaskStreamEvent },
    true,
    new LocalEvidenceReferenceRegistry(),
    { providerId: 'synthetic', modelId: 'synthetic' },
  );
  const availability = {
    type: 'steering_availability' as const,
    mode: 'live' as const,
  };
  observer.onTaskStreamEvent?.(availability);
  observer.onTaskStreamEvent?.({ type: 'steering_applied' });
  observer.onTaskStreamEvent?.({
    type: 'text_delta',
    text: 'withheld synthetic prose',
  });
  expect(onTaskStreamEvent.mock.calls).toEqual([[availability]]);
});
