import type { LanguageModelResponse } from '@orot/model-runtime';
import { canonicalJson, parseJsonOutput, parseResearchPlan, utf8ByteLength } from './protocol';
import type { ResearchPlan } from './protocol';

/** Reject incomplete or oversized research plans before interpreting their contents. */
export async function decodeResearchPlan(
  response: LanguageModelResponse,
  maxPayloadBytes: number,
): Promise<ResearchPlan | undefined> {
  if (response.finishReason !== 'complete' || response.toolCalls.length > 0) return undefined;
  if (await outputExceedsLimit(response, maxPayloadBytes)) return undefined;
  try {
    return parseResearchPlan(await parseJsonOutput(response));
  } catch {
    return undefined;
  }
}

/** Bound both raw and structured provider responses before either can be accepted. */
export async function outputExceedsLimit(
  response: LanguageModelResponse,
  maxPayloadBytes: number,
): Promise<boolean> {
  if (utf8ByteLength(response.text) > maxPayloadBytes) return true;
  try {
    return utf8ByteLength(canonicalJson(await parseJsonOutput(response))) > maxPayloadBytes;
  } catch {
    return false;
  }
}
