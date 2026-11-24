import { coldSessionFixture } from '../testSupport/coldSessionFixture';

test.each([
  { kind: 'retrieval_failed', classified: true, withheld: false },
  { kind: 'stale_evidence', classified: true, withheld: false },
  { kind: 'stale_evidence', classified: true, withheld: true },
  { kind: 'retrieval_failed', classified: false, withheld: false },
] as const)(
  'cold terminal $kind keeps only eligible reviewed text (rejected: $classified, withheld: $withheld)',
  async ({ kind, classified, withheld }) => {
    const f = await coldSessionFixture();
    const reviewed = {
      callId: 'reviewed-opening',
      text: 'Synthetic reviewed opening',
    };
    const oldOpaque = 'Synthetic previous unverified preview';
    const nextOpaque = 'Synthetic new unverified preview';
    let release!: () => void;
    let enter!: () => void;
    const started = new Promise<void>(resolve => {
      enter = resolve;
    });
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    try {
      await f.connection.database.execute(
        'CREATE TEMP TABLE cold_source_revision (revision INTEGER NOT NULL)',
      );
      await f.connection.database.execute(
        'INSERT INTO cold_source_revision VALUES (1)',
      );
      f.updateSession({
        messages: f.session().messages.map(message =>
          message.id === -2
            ? {
                ...message,
                content: oldOpaque,
                initialResponse: reviewed,
                previousOutputs: [oldOpaque],
              }
            : message,
        ),
      });
      const resume = jest
        .spyOn(f.cold, 'resume')
        .mockImplementation(async (identity, _signal, observer) => {
          observer.onTaskStreamEvent?.({
            type: 'text_delta',
            text: nextOpaque,
          });
          enter();
          await held;
          expect(
            (
              await f.connection.database.execute(
                'SELECT revision FROM cold_source_revision',
              )
            ).rows,
          ).toEqual([{ revision: 2 }]);
          return {
            status: 'completed',
            sourceOwner: { ...identity, operationRunId: 'run' },
            outcome: {
              status: 'failure',
              kind,
              ...(classified && kind === 'retrieval_failed'
                ? { discardUnverifiedDraft: true as const }
                : {}),
            },
          };
        });
      const running = f.requests.resumeCold(1, 'request');
      await started;
      await f.connection.database.execute(
        'UPDATE cold_source_revision SET revision = 2',
      );
      if (withheld) {
        const pending = f.session().pendingMessage!;
        f.updateSession({
          pendingMessage: { ...pending, withholdHealthBody: true },
        });
      }
      release();
      await running;
      expect(resume).toHaveBeenCalledTimes(1);
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.createId).not.toHaveBeenCalled();
      expect(await f.storage.read('request')).toBeNull();
      const rows = f.session().messages;
      expect(rows[0]?.role).toBe('user');
      if (withheld) expect(rows).toHaveLength(1);
      else if (classified) {
        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual({
          id: -2,
          role: 'assistant',
          content: '',
          initialResponse: reviewed,
          rejectedOpeningTurnId: 'request',
          incomplete: true,
        });
      } else {
        expect(rows[1]?.content).toContain(nextOpaque);
        expect(rows[1]?.initialResponse).toEqual(reviewed);
      }
      expect(rows.some(message => message.coldResume)).toBe(false);
    } finally {
      release();
      f.requests.dispose();
      f.connection.close();
    }
  },
);
