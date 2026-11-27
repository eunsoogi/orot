import { providerSuccess } from '@orot/model-runtime';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { consent } from '../__fixtures__/sqliteReview';
import { fixture, harness } from '../__fixtures__/longReviewHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test('explicit long review Save binds normalized evidence text to its exact source span', async () => {
  const f = await harness(9);
  try {
    const startOffset = 9;
    const endOffset = 16;
    const sourceText = f.final.text;
    const quote = sourceText.slice(startOffset, endOffset);
    expect(quote).toBe(' ninth ');
    const selected = await jest.mocked(resolveSelectedAiProvider)();
    if (selected.status !== 'ready')
      throw new Error('Synthetic provider missing.');
    const generate = selected.provider.generate.bind(selected.provider);
    jest
      .spyOn(selected.provider, 'generate')
      .mockImplementation(async (...args) => {
        const result = await generate(...args);
        if (!result.ok) return result;
        const reply = JSON.parse(result.value.text ?? '');
        for (const candidate of reply.value.candidates)
          candidate.evidence = [
            { segmentId: f.final.id, startOffset, endOffset, quote },
          ];
        return providerSuccess({
          ...result.value,
          text: JSON.stringify(reply),
        });
      });

    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    expect(f.controller.state.candidates[0]?.evidence).toEqual([
      { segmentId: f.final.id, startOffset, endOffset, quote },
    ]);
    expect(await fixture.rows()).toEqual([]);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('saved');
    expect(f.calls()).toBe(2);

    const spans = (await f.repository.list('evidence_span')).filter(
      span => span.provenance.source?.sourceIdentifier === f.final.id,
    );
    const text = spans.find(span => span.locator?.kind === 'text_range');
    const audio = spans.find(span => span.locator?.kind === 'audio_time_range');
    expect(spans).toHaveLength(2);
    expect(audio).toMatchObject({
      text: quote.trim(),
      locator: { kind: 'audio_time_range', ...f.final.audioRange },
    });
    if (!text || text.locator?.kind !== 'text_range')
      throw new Error('Exact saved text locator missing.');
    expect(text.text).toBe(quote.trim());
    expect(
      sourceText.slice(text.locator.startOffset, text.locator.endOffset),
    ).toBe(text.text);
    expect(text.locator).toEqual({
      kind: 'text_range',
      startOffset: 10,
      endOffset: 15,
    });
  } finally {
    f.controller.dispose();
  }
});
