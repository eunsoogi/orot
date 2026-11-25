import { consent } from '../__fixtures__/sqliteReview';
import { fixture, harness } from '../__fixtures__/longReviewHarness';

test.each(['save', 'edit', 'lock', 'dispose'] as const)(
  'production long route reaches only a complete exact review and handles %s',
  async mode => {
    const f = await harness();
    try {
      await f.controller.start(consent);
      expect(f.controller.state.status).toBe('pending');
      expect(f.controller.state.pending?.segments).toHaveLength(9);
      expect(f.controller.state.pending?.segments.at(-1)?.id).toBe(f.final.id);
      expect(f.controller.state.candidates[0]?.evidence[0]?.segmentId).toBe(
        f.final.id,
      );
      expect(f.calls()).toBe(2);
      expect(await fixture.rows()).toHaveLength(0);
      if (mode === 'lock') {
        f.listeners.forEach(listener =>
          listener({ kind: 'protectedData', available: false }),
        );
        expect(f.controller.state.status).toBe('unavailable');
      } else if (mode === 'dispose') {
        f.controller.dispose();
        f.controller.activate();
        await f.controller.restore();
        expect(f.controller.state.status).not.toBe('pending');
      } else {
        if (mode === 'edit')
          await f.repository.transcripts.correct(
            f.final.id,
            'Retired.',
            f.final.recordedAt,
          );
        await f.controller.decide('approve');
        expect(f.controller.state.status).toBe(
          mode === 'save' ? 'saved' : 'unavailable',
        );
      }
      expect(await fixture.rows()).toHaveLength(mode === 'save' ? 1 : 0);
      expect(f.calls()).toBe(2);
    } finally {
      f.controller.dispose();
    }
  },
);

test('reviews all 33 on-device candidates; explicitly saves only the terminal evidence', async () => {
  const f = await harness(33);
  try {
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    expect(f.controller.state.candidates).toHaveLength(33);
    expect(f.controller.state.selected).toEqual([]);
    expect(f.calls()).toBe(5);
    expect(await fixture.rows()).toHaveLength(0);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('pending');
    expect(await fixture.rows()).toHaveLength(0);
    const last = f.controller.state.candidates.at(-1)!;
    expect(last.evidence[0]?.segmentId).toBe(f.final.id);
    f.controller.toggle(last.id);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('saved');
    expect(await fixture.rows()).toHaveLength(1);
    expect(f.calls()).toBe(5);
  } finally {
    f.controller.dispose();
  }
});
