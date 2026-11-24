import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';

// Hoist the native boundary mock before the direct import is evaluated.
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const fixture = sqliteReviewFixture();

function heldOpen() {
  let notifyStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {
    notifyStarted = resolve;
  });
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  jest.mocked(openLocalAgentMemoryDatabase).mockImplementationOnce(async () => {
    notifyStarted();
    await hold;
    return fixture.database();
  });
  return { started, release };
}

test.each([true, false])(
  'preserves the existing review until an admitted start can own it (stop: %s)',
  async stop => {
    const original = fixture.controllerFor();
    const noExternalConsent = {
      authorize: jest.fn(async () => 'renewal_required' as const),
    };
    const previous = await original.service.start(
      sourceId,
      noExternalConsent,
      new AbortController().signal,
    );
    expect(previous.status).toBe('pending');
    if (previous.status !== 'pending')
      throw new Error('Expected the fixture review to be pending.');
    const transcript = await fixture
      .repository()
      .transcripts.listForRecording(sourceId);

    const { service, synthetic } = fixture.controllerFor();
    const opening = heldOpen();
    const attempt = new AbortController();
    const result = service.start(sourceId, noExternalConsent, attempt.signal);
    await opening.started;
    if (stop) attempt.abort();
    opening.release();
    const next = await result;
    expect(next.status).toBe(stop ? 'cancelled' : 'pending');
    expect(synthetic.calls()).toBe(stop ? 0 : 1);
    expect(noExternalConsent.authorize).not.toHaveBeenCalled();

    // The public read route must still find the old result after Stop. A live
    // start may replace it with a newly generated review exactly once.
    const restored = await service.restore(
      sourceId,
      new AbortController().signal,
    );
    expect(restored).toEqual(stop ? previous : next);
    if (!stop && next.status === 'pending')
      expect(next.pending.threadId).not.toBe(previous.pending.threadId);
    expect(synthetic.calls()).toBe(stop ? 0 : 1);
    expect(await fixture.rows()).toHaveLength(0);
    expect(
      await fixture.repository().transcripts.listForRecording(sourceId),
    ).toEqual(transcript);
  },
);
