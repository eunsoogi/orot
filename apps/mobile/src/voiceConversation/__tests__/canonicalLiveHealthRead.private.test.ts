import { utf8ByteLength } from '../../aiFeatures/integration/evidenceUtils';
import { fixture, call as legacyCall } from '../testSupport/liveResponsesProtectedFixture';
import {
  createCanonicalLiveHealthRead,
  type CanonicalHealthLiveReceipt,
} from '../canonicalLiveHealthRead';

const canonicalCall = {
  ...legacyCall,
  name: 'local-health-context',
  args: JSON.stringify({
    days: 7,
    topics: ['measurements'],
    detail: 'summary',
  }),
} as const;

test.each(['allow', 'deny-local', 'deny-transfer', 'wrong-grant', 'edit', 'detach'] as const)(
  'serial canonical health invocation over actual guarded SQLite: %s',
  async (mode) => {
    const f = await fixture();
    f.setActive(canonicalCall);
    let registeredRetirement: (() => void) | undefined;
    try {
      const approveLocal = jest.fn(async () => mode !== 'deny-local');
      const openData = jest.fn(f.input.openData);
      const approveTransfer = jest.fn(async () => {
        if (mode === 'edit') await f.edit();
        if (mode === 'detach') f.revokeDbOwner();
        return mode === 'deny-transfer' ? undefined : () => true;
      });
      const holdDelivery = jest.fn((_call, beforeDispatch) => {
        const release = beforeDispatch(() => {});
        if (!release) return undefined;
        registeredRetirement = release;
        return release;
      });
      const execute = createCanonicalLiveHealthRead({
        resolve: async () =>
          mode === 'wrong-grant'
            ? ({
                capability: 'orot_health_context',
                current: () => true,
              } as unknown as CanonicalHealthLiveReceipt)
            : { capability: 'local-health-context', current: () => true },
        owns: f.input.isChallengeCurrent,
        protectedCurrent: f.input.protectedDataCurrent,
        protectedAvailable: async () => true,
        approveLocal,
        approveTransfer,
        openData,
        holdDelivery,
        settle: f.settle,
      });
      await execute(canonicalCall, f.controller.signal);
      await execute(canonicalCall, f.controller.signal);
      expect(f.settle).toHaveBeenCalledTimes(1);
      if (mode === 'allow') {
        expect(approveLocal).toHaveBeenCalledWith(
          canonicalCall,
          canonicalCall.args,
          f.controller.signal,
        );
        const exact = f.settle.mock.calls[0]?.[2];
        expect(typeof exact).toBe('string');
        expect(approveTransfer).toHaveBeenCalledWith(canonicalCall, exact, f.controller.signal);
        expect(exact).toContain('heart_rate');
        expect(utf8ByteLength(String(exact))).toBeGreaterThan(2048);
        expect(utf8ByteLength(String(exact))).toBeLessThanOrEqual(8192);
        const parsed = JSON.parse(exact!);
        expect(parsed).toMatchObject({
          tool: 'local-health-context',
          items: [
            {
              evidenceId: expect.any(String),
              evidenceRevision: expect.any(String),
            },
          ],
        });
        expect(parsed).not.toHaveProperty('conversationId');
        expect(holdDelivery).toHaveBeenCalledTimes(1);
      } else {
        expect(f.settle.mock.calls[0]?.[2]).toBeNull();
        expect(holdDelivery).not.toHaveBeenCalled();
        if (mode === 'deny-transfer' || mode === 'edit' || mode === 'detach') {
          expect(approveTransfer).toHaveBeenCalledTimes(1);
        }
        if (mode === 'deny-local' || mode === 'wrong-grant') {
          expect(openData).not.toHaveBeenCalled();
          expect(f.read).not.toHaveBeenCalled();
        }
      }
    } finally {
      registeredRetirement?.();
      f.close();
    }
  },
);
