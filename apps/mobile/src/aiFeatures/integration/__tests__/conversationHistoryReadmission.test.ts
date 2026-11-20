import { loadConversationHistory } from '../conversationHistorySources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

/** The replacement is loaded under the same lease; no prior validated payload is mutated. */
test.each(['revised', 'unknown-error', 'twice-stale'] as const)(
  'readmits only one current history snapshot (%s)',
  async mode => {
    const registry = new LocalEvidenceReferenceRegistry();
    const controller = new AbortController();
    const turn = {
      id: 'synthetic-turn',
      revision: 'old',
      question: 'Synthetic prior question',
      answer: 'Synthetic old answer',
      sources: [],
    };
    const changed = {
      ...turn,
      revision: 'new',
      answer: 'Synthetic current answer',
    };
    const readSession = jest
      .fn()
      .mockResolvedValueOnce({ items: [turn], unavailableCount: 0 })
      .mockResolvedValueOnce({ items: [changed], unavailableCount: 0 });
    if (mode === 'unknown-error')
      readSession
        .mockReset()
        .mockRejectedValue(new Error('Synthetic database failure'));
    const discovery = {
      readSession,
      activeSessionVersion: async () => 2,
      revalidateSession: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(mode === 'revised'),
    };
    const history = loadConversationHistory({
      session: { id: 'session', version: 2 },
      retainedHistory: [{ id: turn.id, question: turn.question }],
      messages: [{ role: 'user', content: turn.question }],
      data: { conversationArtifactDiscovery: async () => discovery } as never,
      registry,
      signal: controller.signal,
      recoverImplicitHistory: true,
    });
    if (mode === 'revised') {
      await expect(history).resolves.toMatchObject({
        priorTurns: [{ question: turn.question, answer: changed.answer }],

        omitted: false,
      });
      const [reference] = (await history).references;
      expect(reference && registry.resolve(reference)?.sourceRevision).toBe(
        changed.revision,
      );
      expect(turn.answer).toBe('Synthetic old answer');
    } else if (mode === 'unknown-error')
      await expect(history).rejects.toThrow('Synthetic database failure');
    else
      await expect(history).rejects.toMatchObject({
        code: 'history_sources_stale',
      });
    expect(readSession).toHaveBeenCalledTimes(mode === 'unknown-error' ? 1 : 2);
  },
);
