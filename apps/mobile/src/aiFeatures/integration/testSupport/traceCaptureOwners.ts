import * as bound from '../boundConversationCapture';
import * as generated from '../conversationCaptureBatch';
import type { ConversationCaptureOwner } from '../evidenceCaptureBatch';

/** Test-only attribution preserves exact returned owners and all callbacks.
 * The actual capture pipeline awaits these nested boundaries sequentially. */
export function traceCaptureOwners() {
  let current = 'outside';
  async function within<T>(label: string, work: () => Promise<T>) {
    const before = current;
    current = label;
    try {
      return await work();
    } finally {
      current = before;
    }
  }
  function wrap(owner: ConversationCaptureOwner, label: string) {
    const prepare = owner.prepare.bind(owner);
    owner.prepare = (...args) =>
      within(`${label}.prepare`, async () => {
        const prepared = await prepare(...args);
        return {
          ...prepared,
          finish: () => within(`${label}.finish`, prepared.finish),
        };
      });
    return owner;
  }
  const originalBound = bound.createBoundConversationCaptureOwner;
  const originalGenerated = generated.createConversationCaptureOwner;
  const first = jest
    .spyOn(bound, 'createBoundConversationCaptureOwner')
    .mockImplementation(input => wrap(originalBound(input), 'bound'));
  const second = jest
    .spyOn(generated, 'createConversationCaptureOwner')
    .mockImplementation(input => wrap(originalGenerated(input), 'generated'));
  return {
    current: () => current,
    restore: () => {
      first.mockRestore();
      second.mockRestore();
    },
  };
}
