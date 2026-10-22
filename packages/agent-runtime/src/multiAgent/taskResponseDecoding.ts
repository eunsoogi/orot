import { parseJsonOutput, parseTaskOutput, type TaskRoleOutput } from './protocol';

/** Diagnose only the rejected envelope's shape. Never retain keys, values or parser errors. */
export function decodeTaskResponse<TResult>(response: {
  readonly text: string;
  readonly structuredOutput?: unknown;
}): { output?: TaskRoleOutput<TResult>; reason?: string } {
  let value: unknown;
  try {
    value = parseJsonOutput(response);
  } catch {
    return rejected('json');
  }
  const output = parseTaskOutput<TResult>(value);
  if (output) return { output };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rejected('object');
  const envelope = value as Record<string, unknown>;
  if (envelope.type === 'result') {
    if (!Array.isArray(envelope.citations)) return rejected('citations');
    if (!('value' in envelope)) return rejected('value');
    return rejected('fields');
  }
  if (envelope.type === 'request_evidence') {
    // The existing parser already accepted valid needs with exactly the permitted fields.
    return rejected(
      Object.keys(envelope).some((key) => !['type', 'need'].includes(key)) ? 'fields' : 'need',
    );
  }
  return rejected('type');
}

function rejected(code: 'json' | 'object' | 'type' | 'citations' | 'value' | 'fields' | 'need') {
  return { reason: `The task responder returned an invalid envelope: ${code}.` };
}
