import * as operations from '../../../healthEvidence/healthContext/healthContextReadOperation';
import * as evidence from '../healthContextEvidence';

/** Observe factory issuance without replacing readers, validators, or registry methods. */
export function tracePeriodReaderProvenance() {
  const issued = new WeakSet<object>();
  const stats = { factory: 0, unregistered: 0 };
  const registerOwner = operations.registerHealthContextReadOwner;
  const registerEvidence = evidence.registerHealthContextEvidence;
  const ownerSpy = jest
    .spyOn(operations, 'registerHealthContextReadOwner')
    .mockImplementation((...args) => {
      issued.add(args[0]);
      return registerOwner(...args);
    });
  const evidenceSpy = jest
    .spyOn(evidence, 'registerHealthContextEvidence')
    .mockImplementation(input => {
      stats[issued.has(input.read) ? 'factory' : 'unregistered']++;
      return registerEvidence(input);
    });
  return {
    stats,
    restore() {
      evidenceSpy.mockRestore();
      ownerSpy.mockRestore();
    },
  };
}
