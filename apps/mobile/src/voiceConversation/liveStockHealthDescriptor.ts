import { nativeToolParameterSchema } from '@orot/agent-runtime';
import { healthContextToolDefinition } from '../conversationTools/healthContextToolDefinition';
import { parseHealthContextToolInput } from '../conversationTools/healthContextTool';
import { jsonByteLength } from '../aiFeatures/integration/evidenceUtils';
import { createStockLiveToolCatalog } from './stockLiveToolCatalog';

const definition = healthContextToolDefinition('rag');

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Matches the existing native canonical payload; this is validation, not approval. */
function acceptsHealthResult(serialized: string) {
  const value: unknown = JSON.parse(serialized);
  if (
    jsonByteLength(value) > 8192 ||
    !record(value) ||
    Object.keys(value).length !== 2 ||
    value.tool !== definition.id ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 5
  )
    return false;
  const identities = new Set<string>();
  for (const item of value.items as unknown[]) {
    if (
      !record(item) ||
      Object.keys(item).length !== 3 ||
      typeof item.evidenceId !== 'string' ||
      !item.evidenceId ||
      identities.has(item.evidenceId) ||
      typeof item.evidenceRevision !== 'string' ||
      !item.evidenceRevision ||
      typeof item.content !== 'string' ||
      !item.content
    )
      return false;
    identities.add(item.evidenceId);
  }
  return true;
}

export const liveStockHealthCatalog = createStockLiveToolCatalog(
  'canonical-health-context-v3',
  [
    {
      declaration: {
        name: definition.id,
        description: definition.description,
        parameters: nativeToolParameterSchema(definition.inputSchema),
      },
      arguments: {
        maxCodeUnits: 1024,
        acceptsExact: serialized =>
          Boolean(parseHealthContextToolInput(JSON.parse(serialized), true)),
      },
      result: {
        maxCodeUnits: 8192,
        acceptsExact: acceptsHealthResult,
      },
    },
  ],
);
