import { StandardSchemaOutputParser } from '@langchain/core/output_parsers';
import { parseTaskOutput, type TaskRoleOutput } from './protocol';

/** Decode with LangChain and expose only a closed failure code, never model content or parser errors. */
export async function decodeTaskResponse<TResult>(response: {
  readonly text: string;
  readonly structuredOutput?: unknown;
}): Promise<{ output?: TaskRoleOutput<TResult>; reason?: string }> {
  if (response.structuredOutput !== undefined) {
    const output = parseTaskOutput<TResult>(response.structuredOutput);
    return output ? { output } : rejected(classifyFailure(response.structuredOutput));
  }

  const parserFailure: { code?: ResponseFailureCode } = {};
  const schema = {
    '~standard': {
      version: 1 as const,
      vendor: 'orot-agent-runtime',
      validate(value: unknown) {
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
    return { output };
  } catch {
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
