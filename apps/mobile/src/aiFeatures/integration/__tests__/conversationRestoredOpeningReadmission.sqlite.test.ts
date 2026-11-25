import type { runRagConversationTurn } from '../../../ragConversation/service';
import { startPreparedRagOpening } from '../preparedOpeningConsent';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

jest.mock('../preparedOpeningConsent', () => ({
  startPreparedRagOpening: jest.fn(),
}));

const retainedHistory = [
  { id: 'older', question: 'Synthetic older question' },
  { id: 'newer', question: 'Synthetic safe question' },
] as const;

test.each([
  'ordinary',
  'specialized',
  'explicit literature',
  'retired session',
  'stopped',
] as const)(
  'only an implicit restored composer read can renew before first search: %s',
  async mode => {
    const f = await quarantinedHistoryFixture();
    const controller = new AbortController();
    let openingEntered!: () => void;
    let openingReleased!: () => void;
    const opening = new Promise<void>(done => {
      openingEntered = done;
    });
    const pending = new Promise<void>(done => {
      openingReleased = done;
    });
    const ready = jest.fn(openingEntered);
    const dispose = jest.fn();
    jest
      .mocked(startPreparedRagOpening)
      .mockReturnValue({ done: pending, ready, dispose });
    const recheck = jest.spyOn(f.storage, 'readProtectedPromptHistory');
    const provider = publicEvidenceFixture();
    const generate = jest.fn(async () => {
      throw new Error('Unexpected model dispatch.');
    });
    const runner = jest.fn<
      ReturnType<typeof runRagConversationTurn>,
      Parameters<typeof runRagConversationTurn>
    >(async () => ({
      status: 'answer',
      answer: 'Safe synthetic continuation',
      citations: [],
    }));
    const externalSearch = jest.fn();
    const send = createRagConversationService({
      ...f.input,
      consent: provider.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: externalSearch },
      selectedAi: async () => ({
        ...provider.selected,
        provider: {
          ...provider.selected.provider,
          generate,
          searchPublicWeb: undefined,
        },
      }),
      ragRunner: runner,
    });
    try {
      const response = send(
        mode === 'explicit literature'
          ? 'Europe PMC에서 관련 논문을 찾아 설명해줘.'
          : '안녕하세요',
        retainedHistory.map(({ question }) => ({
          role: 'user',
          content: question,
        })),
        controller.signal,
        {
          inputOrigin: 'composer',
          retentionSession: { id: 'session', version: 0 },
          retainedHistory,
        },
        mode === 'specialized'
          ? { intent: 'health-summary', entryKey: 'synthetic-summary' }
          : mode === 'explicit literature'
            ? { intent: 'conversation', entryKey: 'synthetic-literature' }
            : undefined,
      );
      await opening;
      expect(recheck).toHaveBeenCalledTimes(1);
      expect(runner).not.toHaveBeenCalled();
      if (mode === 'retired session') await f.storage.deleteSession('session');
      else if (mode === 'stopped') controller.abort();
      else
        await f.database.execute(
          'DELETE FROM conversation_artifacts WHERE id=?',
          ['older'],
        );
      openingReleased();
      const outcome = await response;
      if (mode === 'ordinary') {
        expect(outcome).toMatchObject({ status: 'answer' });
        expect(runner).toHaveBeenCalledTimes(1);
        const request = runner.mock.calls[0]?.[0];
        expect(request?.validatedPriorTurns).toEqual([
          {
            question: 'Synthetic safe question',
            answer: 'Synthetic safe answer',
          },
        ]);
        expect(request?.priorDialogueOmitted).toBe(true);
        expect(JSON.stringify(request?.previousMessages)).not.toContain(
          'Synthetic older question',
        );
      } else {
        expect(outcome).toMatchObject({ status: 'failure' });
        expect(runner).not.toHaveBeenCalled();
      }
      expect(recheck).toHaveBeenCalledTimes(
        mode === 'ordinary' || mode === 'retired session' ? 2 : 1,
      );
      expect(ready).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
      expect(provider.search).not.toHaveBeenCalled();
      expect(externalSearch).not.toHaveBeenCalled();
    } finally {
      openingReleased();
      controller.abort();
      recheck.mockRestore();
      f.close();
    }
  },
);
