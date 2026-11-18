import { bindConversationSources } from '../conversationSourceBindings';
import { hasOwnedBoundConversationCapture } from '../evidenceCaptureBatch';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { createBoundConversationCaptureOwner } from '../boundConversationCapture';
import {
  registerBoundCaptureAuthority,
  ownsBoundCaptureAuthority,
  canBindBoundCapture,
} from '../boundCaptureAuthority';
import { fingerprint } from '../evidenceUtils';

/** Exact factory readers, dynamic callback gates and final native checks are independent. */
async function fixture() {
  const f = await diverseHistoryProfileFixture(1, false);
  const registry = f.input.registry;
  const saved = (await f.storage.read('turn-0'))!;
  let changed = false;
  const inner = registry.add({
    reference: { ...saved.citations![0]!, sourceKind: 'personal_record' },
    content: '',
    validate: async () => !changed,
    readSource: async () =>
      changed
        ? { status: 'changed' }
        : {
            status: 'available',
            document: { sourceKind: 'personal_record', records: [] },
          },
  });
  const owner = createBoundConversationCaptureOwner({
    storage: f.storage,
    registry,
  });
  const discovery = { read: async () => null };
  registerBoundCaptureAuthority(owner, discovery, f.storage, registry);
  const request = {
    id: inner.sourceId,
    revision: inner.sourceRevision,
    bound: {
      parentId: saved.id,
      parentRevision: fingerprint(saved),
      reference: inner,
    },
  };
  return {
    ...f,
    registry,
    saved,
    owner,
    discovery,
    request,
    change: () => {
      changed = true;
    },
  };
}

test.each([
  'read',
  'readMany',
  'readSource',
  'revalidateEvidence',
  'discovery',
  'native',
  'delete',
  'hide',
  'generation',
  'abort',
] as const)(
  'bound authority fails closed after %s changes during other source await',
  async mutation => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      expect(ownsBoundCaptureAuthority(f.owner)).toBe(true);
      const prepared = await f.owner.prepare([f.request], controller.signal);
      expect(prepared.results[0]?.status).toBe('available');
      if (mutation === 'read' || mutation === 'readMany') {
        const original = f.storage[mutation];
        Object.assign(f.storage, {
          [mutation]: (...args: never[]) => (original as Function)(...args),
        });
      } else if (
        mutation === 'readSource' ||
        mutation === 'revalidateEvidence'
      ) {
        const original = f.registry[mutation].bind(f.registry);
        Object.assign(f.registry, {
          [mutation]: (...args: never[]) => (original as Function)(...args),
        });
      } else if (mutation === 'discovery') f.discovery.read = async () => null;
      else if (mutation === 'native') f.change();
      else if (mutation === 'delete')
        await f.repository.delete('health_observation', f.inside.id);
      else if (mutation === 'hide')
        await f.database.execute(
          "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
        );
      else if (mutation === 'generation')
        await f.database.execute(
          'UPDATE conversation_artifact_generation SET generation=generation+1',
        );
      else controller.abort();
      await expect(prepared.finish()).resolves.toBe(false);
    } finally {
      f.close();
    }
  },
);

test('custom readers and another binding storage cannot borrow factory authority', async () => {
  const f = await fixture();
  try {
    expect(canBindBoundCapture(f.owner, f.storage)).toBe(true);
    expect(canBindBoundCapture(f.owner, { ...f.storage })).toBe(false);
    const deny = jest.fn(async () => null);
    const alias = bindConversationSources({
      citations: [f.request.bound.reference],
      parentId: f.saved.id,
      parentRevision: fingerprint(f.saved),
      storage: { read: deny },
      registry: f.registry,
      captureOwner: f.owner,
    })![0]!;
    expect(hasOwnedBoundConversationCapture(f.registry, alias)).toBe(false);
    expect(
      (await f.registry.readSource(alias, new AbortController().signal)).status,
    ).not.toBe('available');
    expect(deny).toHaveBeenCalled();
    const custom = { ...f.storage, readMany: async () => [] };
    const owner = createBoundConversationCaptureOwner({
      storage: custom,
      registry: f.registry,
    });
    registerBoundCaptureAuthority(owner, f.discovery, custom, f.registry);
    expect(ownsBoundCaptureAuthority(owner)).toBe(false);
    const native = f.registry.readSource.bind(f.registry);
    f.registry.readSource = (...args) => native(...args);
    expect(ownsBoundCaptureAuthority(f.owner)).toBe(false);
  } finally {
    f.close();
  }
});
