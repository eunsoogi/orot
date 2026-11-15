import type { WorkflowOperationIdentity } from '@orot/agent-runtime';

/** Purpose is internal runtime metadata, not provider text or caller-supplied task data.
 * Storage additionally rejects anything except the bounded tool-less review envelope. */
export function validAuxiliaryReviewIdentity(
  identity: WorkflowOperationIdentity,
): boolean {
  if (identity.purpose === undefined) return true;
  if (identity.purpose !== 'preview_review') return false;
  try {
    const { request } = JSON.parse(identity.input);
    if (
      !request ||
      Object.keys(request).some(
        key => !['messages', 'maxOutputTokens'].includes(key),
      ) ||
      request.tools !== undefined ||
      request.toolChoice !== undefined ||
      !Array.isArray(request.messages) ||
      request.messages.length !== 2 ||
      request.messages[0].role !== 'system' ||
      typeof request.messages[0].content !== 'string' ||
      request.messages[1].role !== 'user'
    )
      return false;
    const data = JSON.parse(request.messages[1].content);
    return (
      Object.keys(data).length === 2 &&
      typeof data.request === 'string' &&
      typeof data.candidate === 'string' &&
      data.candidate.length > 0 &&
      data.candidate.length <= 300
    );
  } catch {
    return false;
  }
}
