import {
  healthContextFixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import {
  createCapturePeriodReads,
  capturedPeriodReader,
} from '../conversationPeriodReadLease';
import { periodCaptureReaders } from '../periodCaptureReaders';
import { validationContext } from '../evidenceValidationContext';
import type { RegistryEntry } from '../evidenceRegistry';

/** Exact original validationContext defers load; authority must not be stale then. */
test.each(['input', 'entry', 'registry', 'scope'] as const)(
  'microtask %s replacement falls back at calculation time',
  async mode => {
    const f = await healthContextFixture();
    const scope = createCapturePeriodReads(signal);
    const input = {
      registry: f.registry,
      read: f.read,
      report: f.report,
      scope: {
        kind: 'health_context_period' as const,
        version: 1 as const,
        topic: 'measurements' as const,
        window,
      },
    };
    let entry: RegistryEntry | undefined;
    const add = f.registry.add.bind(f.registry);
    const spy = jest.spyOn(f.registry, 'add').mockImplementation(value => {
      const item = add(value);
      entry = {
        alias: item,
        original: value.reference,
        readSource: value.readSource,
        validate: value.validate,
      };
      return item;
    });
    registerHealthContextEvidence(input);
    // Only the capture is warm; fallback must issue fresh SQL on the original reader.
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
    await scope.forReader(f.read, f.registry, capturedPeriodReader(f.read))(
      window,
      ['measurements'],
      signal,
    );
    expect(calculations).toBe(2);
    calculations = 0;
    const scoped = periodCaptureReaders(f.registry, entry!, scope);
    try {
      const pending = scoped.validate(signal, validationContext());
      const deny = jest.fn(async () => {
        throw new Error('Changed between scheduling and load');
      });
      if (mode === 'input') input.read = deny;
      if (mode === 'entry')
        Object.assign(entry!, { validate: async () => false });
      if (mode === 'scope') Object.assign(scope, { forReader: () => deny });
      if (mode === 'registry')
        f.registry.revalidateEvidence = async () => false;
      if (mode === 'input') {
        await expect(pending).rejects.toThrow(
          'Changed between scheduling and load',
        );
        expect(deny).toHaveBeenCalledTimes(1);
      } else {
        await expect(pending).resolves.toBe(true);
        expect(calculations).toBe(2);
      }
      if (mode === 'scope') expect(deny).not.toHaveBeenCalled();
    } finally {
      f.database.transaction = transaction;
      spy.mockRestore();
      scope.dispose();
      f.close();
    }
  },
);
