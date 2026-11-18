import {
  healthContextFixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { createCapturePeriodReads } from '../conversationPeriodReadLease';
import {
  LocalEvidenceReferenceRegistry,
  type RegistryEntry,
} from '../evidenceRegistry';
import { readRegistrySource } from '../readRegistrySource';

/** Callback order and late mutation remain source authority, never a report cache. */
test.each(['live', 'capture'] as const)(
  'late input.read replacement is respected by %s',
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
    const item = registerHealthContextEvidence(input);
    const deny = jest.fn(async () => {
      throw new Error('Replacement policy');
    });
    input.read = deny;
    try {
      expect(
        (
          await f.registry.readSource(
            item,
            signal,
            mode === 'capture' ? scope : undefined,
          )
        ).status,
      ).toBe('unavailable');
      expect(deny).toHaveBeenCalledTimes(1);
    } finally {
      scope.dispose();
      f.close();
    }
  },
);

test('input.read changed during the first read is used by validation and never published', async () => {
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
  const item = registerHealthContextEvidence(input);
  const deny = jest.fn(async () => {
    throw new Error('Late policy');
  });
  const transaction = f.database.transaction.bind(f.database);
  await f.repository.put('health_observation', {
    ...f.inside,
    id: 'outside',
    effectiveAt: '2028-01-01T00:00:00Z',
  });
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        const result = await execute(...args);
        if (/WITH days\(/.test(args[0])) input.read = deny;
        return result;
      };
      await work(tx);
    });
  try {
    expect((await f.registry.readSource(item, signal, scope)).status).toBe(
      'unavailable',
    );
    expect(deny).toHaveBeenCalledTimes(1);
  } finally {
    scope.dispose();
    f.database.transaction = transaction;
    f.close();
  }
});

test.each(['missing', 'unavailable', 'available'] as const)(
  'validation failure rereads and preserves %s outcome',
  async latest => {
    const registry = new LocalEvidenceReferenceRegistry();
    const scope = createCapturePeriodReads(signal);
    const order: string[] = [];
    const document = { sourceKind: 'personal_record' as const, records: [] };
    let reads = 0;
    const item = registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: 'synthetic',
        evidenceId: 'synthetic',
        sourceRevision: 'v',
        evidenceRevision: 'v',
        locator: {},
        effectiveTime: null,
        reviewState: 'unknown',
      },
      content: '',
      readSource: async () => {
        order.push('read');
        return reads++ === 0 || latest === 'available'
          ? { status: 'available', document }
          : { status: latest };
      },
      validate: async () => {
        order.push('validate');
        return false;
      },
    });
    try {
      expect((await registry.readSource(item, signal, scope)).status).toBe(
        latest === 'available' ? 'changed' : latest,
      );
      expect(order).toEqual(['read', 'validate', 'read']);
    } finally {
      scope.dispose();
    }
  },
);

test.each(['readSource', 'validate'] as const)(
  'late entry %s callback cannot inherit period authority',
  async field => {
    const f = await healthContextFixture();
    const scope = createCapturePeriodReads(signal);
    const add = f.registry.add.bind(f.registry);
    let entry: RegistryEntry | undefined;
    const spy = jest.spyOn(f.registry, 'add').mockImplementation(input => {
      const item = add(input);
      entry = {
        alias: item,
        original: input.reference,
        readSource: input.readSource,
        validate: input.validate,
      };
      return item;
    });
    registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      report: f.report,
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window,
      },
    });
    const deny = jest.fn(async () => {
      throw new Error('Changed callback');
    });
    Object.assign(entry!, { [field]: deny });
    try {
      expect(
        (await readRegistrySource(f.registry, entry!, signal, scope)).status,
      ).toBe('unavailable');
      expect(deny).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      scope.dispose();
      f.close();
    }
  },
);

test.each(['readSource', 'revalidateEvidence'] as const)(
  'prototype %s override keeps original callback path',
  async field => {
    const f = await healthContextFixture();
    const scope = createCapturePeriodReads(signal);
    const proto = LocalEvidenceReferenceRegistry.prototype;
    const original = proto[field];
    const originalRead = proto.readSource;
    const call = jest.fn();
    Object.assign(proto, {
      [field]: function (
        this: LocalEvidenceReferenceRegistry,
        ...args: never[]
      ) {
        call();
        return (original as Function).apply(this, args);
      },
    });
    const forReader = jest.spyOn(scope, 'forReader');
    try {
      expect(
        (await originalRead.call(f.registry, f.item, signal, scope)).status,
      ).toBe('available');
      expect(forReader).not.toHaveBeenCalled();
    } finally {
      Object.assign(proto, { [field]: original });
      scope.dispose();
      f.close();
    }
  },
);
