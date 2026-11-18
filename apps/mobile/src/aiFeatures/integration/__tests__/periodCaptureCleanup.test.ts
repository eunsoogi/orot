import * as readScopes from '../conversationCaptureReadScope';
import { capturedPeriodReader } from '../conversationPeriodReadLease';
import { captureConversationSources } from '../captureConversationSources';
import {
  healthContextFixture,
  signal,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';

/** A source may see the period context, but cannot replace the caller's cleanup. */
test.each(['success', 'throw'] as const)(
  'replaced public dispose cannot suppress %s finally cleanup',
  async mode => {
    const f = await healthContextFixture();
    const original = readScopes.createConversationCaptureReadScope;
    let captured: ReturnType<typeof original> | undefined;
    const spy = jest
      .spyOn(readScopes, 'createConversationCaptureReadScope')
      .mockImplementation(s => (captured = original(s)));
    const transaction = f.database.transaction.bind(f.database);
    let calculations = 0;
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (...args) => {
          if (/WITH days\(/.test(args[0])) calculations++;
          return execute(...args);
        };
        await work(tx);
      });
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'outside',
      effectiveAt: '2028-01-01T00:00:00Z',
    });
    let escaped: HealthContextReader | undefined;
    const item = f.registry.add({
      reference: {
        ...f.registry.resolve(f.item)!,
        locator: { kind: 'record' },
      },
      content: '',
      readSource: async () => {
        escaped = captured!.periods.forReader(
          f.read,
          f.registry,
          capturedPeriodReader(f.read),
        );
        await escaped(window, ['measurements'], signal);
        Object.assign(captured!.periods, { dispose() {} });
        if (mode === 'throw') throw new Error('Synthetic source failure');
        return {
          status: 'available',
          document: { sourceKind: 'personal_record', records: [] },
        };
      },
      validate: async () => true,
    });
    try {
      const run = captureConversationSources([item], f.registry, signal);
      if (mode === 'success') await run;
      else await expect(run).rejects.toThrow();
      const before = calculations;
      await escaped!(window, ['measurements'], signal);
      expect(calculations).toBe(before + 2);
    } finally {
      spy.mockRestore();
      f.database.transaction = transaction;
      f.close();
    }
  },
);
