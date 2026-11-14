import type { JsonObject } from '@orot/model-runtime';
import type { ConversationResumeManifest } from './conversationWorkflowResumeStorage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** Protected reconstruction input only. Never serialize grants, credentials, providers or closures. */
export interface ConversationColdResumeDescriptor {
  version: 1;
  manifest: ConversationResumeManifest;
  checkpointId: string;
  attempt: number;
  sourceEpoch: number;
  request: string;
  submittedInput: string | null;
  exactInput: string;
  /** App-owned versioned invocation and source/alias snapshots; fresh factories must validate them. */
  reconstruction: JsonObject;
}

/** Reject non-JSON and oversized values instead of silently dropping functions or undefined fields. */
export function encodeColdResume(
  value: ConversationColdResumeDescriptor,
): string {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (
      typeof item === 'undefined' ||
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    )
      throw new Error('Non-JSON cold resume descriptor.');
    return item;
  });
  if (json.length > 2_000_000)
    throw new Error('Cold resume descriptor is too large.');
  const parsed = JSON.parse(json) as ConversationColdResumeDescriptor;
  if (
    parsed.version !== 1 ||
    !parsed.manifest ||
    !parsed.checkpointId ||
    !Number.isSafeInteger(parsed.attempt) ||
    parsed.attempt < 0 ||
    !Number.isSafeInteger(parsed.sourceEpoch) ||
    parsed.sourceEpoch < 0 ||
    typeof parsed.request !== 'string' ||
    typeof parsed.exactInput !== 'string' ||
    !parsed.exactInput ||
    (parsed.submittedInput !== null &&
      typeof parsed.submittedInput !== 'string') ||
    !parsed.reconstruction ||
    typeof parsed.reconstruction !== 'object' ||
    Array.isArray(parsed.reconstruction)
  )
    throw new Error('Invalid cold resume descriptor.');
  return stableJson(parsed);
}
