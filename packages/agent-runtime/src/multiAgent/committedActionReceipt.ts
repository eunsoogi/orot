import type { EvidenceReference } from './evidenceContracts';
import { isEvidenceReference } from './evidence';

/** Public checkpoint identity only. Inputs, health prose and grants remain protected.
 * This manifest does not authorize replay or prove a domain transaction by itself.
 */
export interface CommittedActionReceipt {
  readonly version: 1;
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly evidenceReferences: readonly EvidenceReference[];
}

export function committedActionReceiptMatches(
  value: unknown,
  expected: {
    operationRunId: string;
    operationKey: string;
    toolId: string;
    toolVersion: string;
    evidenceReferences: readonly EvidenceReference[];
  },
): value is CommittedActionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as CommittedActionReceipt;
  return (
    receipt.version === 1 &&
    receipt.operationRunId === expected.operationRunId &&
    receipt.operationKey === expected.operationKey &&
    receipt.toolId === expected.toolId &&
    receipt.toolVersion === expected.toolVersion &&
    /^tool-[1-9]\d*$/u.test(receipt.operationKey) &&
    Array.isArray(receipt.evidenceReferences) &&
    receipt.evidenceReferences.length > 0 &&
    receipt.evidenceReferences.every(isEvidenceReference) &&
    JSON.stringify(receipt.evidenceReferences) === JSON.stringify(expected.evidenceReferences)
  );
}
