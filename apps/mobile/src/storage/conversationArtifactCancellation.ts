export function assertConversationNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('The conversation output was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}
