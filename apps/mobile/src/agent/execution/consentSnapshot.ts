import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { consentRevision } from './consentRevision';

function encodeSnapshotValue(
  value: unknown,
  seen: Set<object>,
): string | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  if (value instanceof Uint8Array) {
    return `{"$bytes":"${Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')}"}`;
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = value.map(item => encodeSnapshotValue(item, seen));
      return entries.some(entry => entry === undefined)
        ? undefined
        : `[${entries.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const record = value as Record<string, unknown>;
    const entries: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const encoded = encodeSnapshotValue(record[key], seen);
      if (encoded === undefined) {
        if (record[key] === undefined) continue;
        return undefined;
      }
      entries.push(`${JSON.stringify(key)}:${encoded}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function consentSnapshot(
  request: OutboundProcessingRequest,
  includeRun = true,
): string | undefined {
  const payload = encodeSnapshotValue(request.payload, new Set());
  const scope = encodeSnapshotValue(request.allowedScope, new Set());
  if (!payload || !scope) return undefined;
  return JSON.stringify({
    ...(includeRun
      ? { operationRunId: request.operationRunId, revision: consentRevision() }
      : {}),
    providerId: request.providerId,
    modelId: request.modelId,
    recipient: request.recipient,
    consentScope: request.consentScope,
    allowedScope: scope,
    payload,
  });
}
