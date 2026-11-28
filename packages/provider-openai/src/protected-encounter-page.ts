import {
  providerFailure,
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';

/** Only the dedicated native transport may reconstruct these already approved
 * contents. They are positional roles, never general Conversation history. */
export interface ProtectedEncounterPageWire {
  readonly instruction: string;
  readonly transcript: string;
  readonly citations: string;
  readonly schema: string;
}

export type ProtectedEncounterPageTerminal = Readonly<{
  readonly text: string;
}>;

/** Native must independently prove the selected account and current exact page
 * authority before this is allowed to send. No production bridge supplies it. */
export type InvokeProtectedEncounterPage = (
  account: string,
  model: string,
  wire: ProtectedEncounterPageWire,
  signal: AbortSignal,
) => Promise<ProtectedEncounterPageTerminal | null>;

export function protectedEncounterPageWire(
  request: LanguageModelRequest,
): ProtectedEncounterPageWire | undefined {
  if (
    Object.keys(request).some((key) => key !== 'messages' && key !== 'tools') ||
    (request.tools !== undefined && request.tools.length > 0) ||
    request.messages.length !== 4
  )
    return;
  const text: string[] = [];
  for (const [index, message] of request.messages.entries()) {
    if (
      message.role !== (index === 0 ? 'system' : 'user') ||
      !('content' in message) ||
      typeof message.content !== 'string' ||
      !message.content.trim() ||
      Object.keys(message).some((key) => key !== 'role' && key !== 'content')
    )
      return;
    text.push(message.content);
  }
  const [instruction, transcript, citations, schema] = text;
  if (!instruction || !transcript || !citations || !schema) return;
  return Object.freeze({ instruction, transcript, citations, schema });
}

export function createProtectedEncounterPageSender(input: {
  readonly issuedClientID: string;
  readonly selectedModel: string;
  readonly isCurrent: () => boolean;
  readonly invoke: InvokeProtectedEncounterPage;
}): LanguageModelProvider['generate'] {
  const { issuedClientID, selectedModel, isCurrent, invoke } = input;
  let started = false;
  const unavailable = () =>
    providerFailure({
      code: 'provider_unavailable',
      message: 'The selected transcript page is unavailable.',
      retryable: false,
    });
  return async (request, options) => {
    const signal = options?.signal;
    const current = () => signal && !signal.aborted && isCurrent();
    try {
      if (
        started ||
        !signal ||
        !current() ||
        !issuedClientID ||
        !selectedModel ||
        options?.midTurnSteering
      )
        return unavailable();
      const page = protectedEncounterPageWire(request);
      if (!page || !current()) return unavailable();
      // Even an ambiguous native failure spends this independently approved page.
      started = true;
      const terminal = await invoke(issuedClientID, selectedModel, page, signal);
      if (
        !current() ||
        !terminal ||
        Object.keys(terminal).length !== 1 ||
        typeof terminal.text !== 'string' ||
        !terminal.text.trim()
      )
        return unavailable();
      return providerSuccess({
        text: terminal.text,
        toolCalls: [],
        finishReason: 'complete',
      });
    } catch {
      return unavailable();
    }
  };
}
