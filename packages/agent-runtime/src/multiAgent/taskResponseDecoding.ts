import { StandardSchemaOutputParser } from '@langchain/core/output_parsers';
import { parseTaskOutput, type TaskRoleOutput } from './protocol';

export interface DecodedPropertyProbe {
  readonly property: string;
  report(outcome: 'present' | 'absent' | 'decode_failed' | 'presence_mismatch'): void;
}

function ownResultProperty(value: unknown, property: string): boolean {
  return (
    !!value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, property)
  );
}

/** Decode with LangChain and expose only a closed failure code, never model content or parser errors. */
export async function decodeTaskResponse<TResult>(
  response: {
    readonly text: string;
    readonly structuredOutput?: unknown;
  },
  probe?: DecodedPropertyProbe,
): Promise<{ output?: TaskRoleOutput<TResult>; reason?: string }> {
  if (response.structuredOutput !== undefined) {
    const output = parseTaskOutput<TResult>(response.structuredOutput);
    return output ? { output } : rejected(classifyFailure(response.structuredOutput));
  }

  let rawPresence: boolean | undefined;
  // Observe only the existing text parser candidate; never re-parse or hand it to a caller.
  const report = (outcome: Parameters<DecodedPropertyProbe['report']>[0]) => {
    try {
      probe?.report(outcome);
    } catch {
      // The diagnostic consumer cannot affect parser or task acceptance.
    }
  };
  const parserFailure: { code?: ResponseFailureCode } = {};
  const schema = {
    '~standard': {
      version: 1 as const,
      vendor: 'orot-agent-runtime',
      validate(value: unknown) {
        if (
          probe &&
          value &&
          typeof value === 'object' &&
          'type' in value &&
          value.type === 'result' &&
          'value' in value
        )
          rawPresence = ownResultProperty(value.value, probe.property);
        const output = parseTaskOutput<TResult>(value);
        if (output) return { value: output };
        const code = classifyFailure(value);
        parserFailure.code = code;
        return { issues: [{ message: code }] };
      },
    },
  } satisfies ConstructorParameters<typeof StandardSchemaOutputParser>[0];

  try {
    const output = await StandardSchemaOutputParser.fromSerializableSchema<TaskRoleOutput<TResult>>(
      schema,
    ).parse(response.text);
    if (probe && output.type === 'result') {
      const presence = ownResultProperty(output.value, probe.property);
      report(rawPresence !== presence ? 'presence_mismatch' : presence ? 'present' : 'absent');
    }
    return { output };
  } catch {
    report('decode_failed');
    return rejected(parserFailure.code ?? 'json');
  }
}

type ResponseFailureCode = 'json' | 'object' | 'type' | 'citations' | 'value' | 'fields' | 'need';

function classifyFailure(value: unknown): Exclude<ResponseFailureCode, 'json'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'object';
  const envelope = value as Record<string, unknown>;
  if (envelope.type === 'result') {
    if (!Array.isArray(envelope.citations)) return 'citations';
    if (!('value' in envelope)) return 'value';
    return 'fields';
  }
  if (envelope.type === 'request_evidence') {
    return Object.keys(envelope).some((key) => !['type', 'need'].includes(key)) ? 'fields' : 'need';
  }
  return 'type';
}

function rejected(code: ResponseFailureCode) {
  return { reason: `The task responder returned an invalid envelope: ${code}.` };
}
