import type {
  AllowedEvidenceScope,
  EvidenceBatch,
  EvidenceSearchTool,
  EvidenceNeed,
  EvidenceReference,
  MultiAgentBudget,
  TaskResponderContract,
  TaskResponderInput,
} from './contracts';
import type { JsonObject } from '@orot/model-runtime';
import { referencesFromBatch } from './evidence';

export type TaskRoleOutput<TResult> =
  | { readonly type: 'result'; readonly value: TResult; readonly citations: readonly unknown[] }
  | { readonly type: 'request_evidence'; readonly need: EvidenceNeed };

export interface ResearchPlan {
  readonly toolId: string;
  readonly sourceKind: string;
  readonly input: JsonObject;
}

const EVIDENCE_NEEDS: readonly EvidenceNeed[] = [
  'missing_coverage',
  'verify_conflict',
  'confirm_value',
  'other',
];

// Providers without native structured output still use the same local parsers and validators.
export function parseJsonOutput(value: {
  readonly text: string;
  readonly structuredOutput?: unknown;
}): unknown {
  if (value.structuredOutput !== undefined) return value.structuredOutput;
  return JSON.parse(value.text) as unknown;
}

export function isEvidenceNeed(value: unknown): value is EvidenceNeed {
  return typeof value === 'string' && EVIDENCE_NEEDS.includes(value as EvidenceNeed);
}

export function taskResponseSchema<TResult>(contract: TaskResponderContract<TResult>): JsonObject {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'need'],
        properties: {
          type: { const: 'request_evidence' },
          need: { enum: EVIDENCE_NEEDS },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'value', 'citations'],
        properties: {
          type: { const: 'result' },
          value: contract.resultSchema,
          citations: { type: 'array', items: { type: 'object' } },
        },
      },
    ],
  } as JsonObject;
}

export function researcherSchema(tools: readonly EvidenceSearchTool[]): JsonObject {
  return {
    oneOf: tools.map((tool) => ({
      type: 'object',
      additionalProperties: false,
      required: ['toolId', 'sourceKind', 'input'],
      properties: {
        toolId: { const: tool.id },
        sourceKind: { const: tool.sourceKind },
        input: tool.inputSchema,
      },
    })),
  } as JsonObject;
}

export function parseTaskOutput<TResult>(value: unknown): TaskRoleOutput<TResult> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = value as Record<string, unknown>;
  if (output.type === 'request_evidence' && isEvidenceNeed(output.need)) {
    if (Object.keys(output).some((key) => !['type', 'need'].includes(key))) return undefined;
    return { type: 'request_evidence', need: output.need };
  }
  if (output.type === 'result' && Array.isArray(output.citations) && 'value' in output) {
    if (Object.keys(output).some((key) => !['type', 'value', 'citations'].includes(key)))
      return undefined;
    return {
      type: 'result',
      value: output.value as TResult,
      citations: output.citations,
    };
  }
  return undefined;
}

export function parseResearchPlan(value: unknown): ResearchPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const plan = value as Record<string, unknown>;
  if (
    typeof plan.toolId !== 'string' ||
    typeof plan.sourceKind !== 'string' ||
    !isJsonObject(plan.input)
  ) {
    return undefined;
  }
  if (Object.keys(plan).some((key) => !['toolId', 'sourceKind', 'input'].includes(key)))
    return undefined;
  return { toolId: plan.toolId, sourceKind: plan.sourceKind, input: plan.input };
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

export function citationReferences(
  citations: readonly unknown[],
  evidence: EvidenceBatch,
): EvidenceReference[] | undefined {
  const allowed = referencesFromBatch(evidence);
  const result: EvidenceReference[] = [];
  for (const citation of citations) {
    if (!citation || typeof citation !== 'object' || Array.isArray(citation)) return undefined;
    const exact = allowed.find((reference) => canonicalJson(reference) === canonicalJson(citation));
    if (!exact || result.some((prior) => canonicalJson(prior) === canonicalJson(exact)))
      return undefined;
    result.push(exact);
  }
  return result;
}

export function buildTaskMessages<TResult>(
  contract: TaskResponderContract<TResult>,
  input: TaskResponderInput,
): ReturnType<TaskResponderContract<TResult>['createMessages']> | undefined {
  const messages = contract.createMessages(input);
  for (const message of messages) {
    if (message.role !== 'system' && message.role !== 'user') return undefined;
  }
  return [
    ...messages,
    {
      role: 'user',
      content: `Allowed citation references (cite exact objects only):\n${JSON.stringify(referencesFromBatch(input.evidence))}`,
    },
  ];
}

export function researcherPrompt(
  request: string,
  need: EvidenceNeed,
  tools: readonly EvidenceSearchTool[],
  allowedScope: AllowedEvidenceScope,
  budget: MultiAgentBudget,
): string {
  return [
    'Role: EvidenceResearcher. Choose one bounded, read-only evidence tool and its schema-limited input.',
    'Return JSON with toolId, sourceKind, and input. Do not answer the user task or invent fields.',
    `Need: ${need}`,
    `Task: ${request}`,
    `Allowed source scope: ${JSON.stringify(allowedScope)}`,
    `Allowlisted tools: ${JSON.stringify(tools)}`,
    `Maximum results: ${budget.maxEvidenceItems}`,
  ].join('\n');
}

// Sorted keys make equality stable when provider JSON uses a different object-key order.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
