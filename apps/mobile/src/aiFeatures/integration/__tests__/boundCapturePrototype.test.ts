import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { createBoundConversationCaptureOwner } from '../boundConversationCapture';
import { registerBoundCaptureAuthority } from '../boundCaptureAuthority';
import { bindConversationSources } from '../conversationSourceBindings';
import { hasOwnedBoundConversationCapture } from '../evidenceCaptureBatch';
import { fingerprint } from '../evidenceUtils';
import type { EvidenceReference } from '@orot/agent-runtime';

/** A prototype policy installed before discovery must not become canonical authority. */
test.each(['readSource', 'revalidateEvidence'] as const)(
  'pre-registration prototype %s denying only outer aliases keeps strict fallback',
  async method => {
    const f = await diverseHistoryProfileFixture(1, false);
    let outer: EvidenceReference | undefined;
    const prototype = LocalEvidenceReferenceRegistry.prototype;
    const originalRead = prototype.readSource;
    const originalValidate = prototype.revalidateEvidence;
    const denied = jest.fn();
    try {
      if (method === 'readSource')
        prototype.readSource = async function (ref, signal) {
          if (ref === outer) {
            denied();
            return { status: 'missing' };
          }
          return originalRead.call(this, ref, signal);
        };
      else
        prototype.revalidateEvidence = async function (refs, signal) {
          if (refs.includes(outer!)) {
            denied();
            return false;
          }
          return originalValidate.call(this, refs, signal);
        };
      const registry = f.input.registry;
      const saved = (await f.storage.read('turn-0'))!;
      const inner = registry.add({
        reference: { ...saved.citations![0]!, sourceKind: 'personal_record' },
        content: '',
        validate: async () => true,
        readSource: async () => ({
          status: 'available',
          document: { sourceKind: 'personal_record', records: [] },
        }),
      });
      const owner = createBoundConversationCaptureOwner({
        storage: f.storage,
        registry,
      });
      registerBoundCaptureAuthority(
        owner,
        { read: async () => null },
        f.storage,
        registry,
      );
      outer = bindConversationSources({
        citations: [inner],
        parentId: saved.id,
        parentRevision: fingerprint(saved),
        storage: f.storage,
        registry,
        captureOwner: owner,
      })![0]!;
      if (method === 'readSource')
        expect(
          (await registry.readSource(outer, new AbortController().signal))
            .status,
        ).toBe('missing');
      else
        expect(
          await registry.revalidateEvidence(
            [outer],
            new AbortController().signal,
          ),
        ).toBe(false);
      expect(denied).toHaveBeenCalledTimes(1);
      expect(hasOwnedBoundConversationCapture(registry, outer)).toBe(false);
    } finally {
      prototype.readSource = originalRead;
      prototype.revalidateEvidence = originalValidate;
      f.close();
    }
  },
);
