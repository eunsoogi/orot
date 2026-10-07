import type {
  OutboundProcessingRequest,
  ExecutionConsentPort,
} from '@orot/agent-runtime';

export type ConfirmExecutionConsent = (
  request: OutboundProcessingRequest,
) => Promise<boolean>;

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

function consentSnapshot(
  request: OutboundProcessingRequest,
): string | undefined {
  const payload = encodeSnapshotValue(request.payload, new Set());
  const scope = encodeSnapshotValue(request.allowedScope, new Set());
  if (!payload || !scope) return undefined;
  return JSON.stringify({
    operationRunId: request.operationRunId,
    providerId: request.providerId,
    modelId: request.modelId,
    recipient: request.recipient,
    allowedScope: scope,
    payload,
  });
}

// The registry retains exact snapshots only in memory so consent never silently follows expanded data.
export function createExecutionConsentRegistry(
  confirm: ConfirmExecutionConsent,
): ExecutionConsentPort & {
  clear(operationRunId?: string): void;
} {
  const approved = new Map<string, string>();
  return {
    async authorize(request) {
      if (!request.remoteProcessing) return 'authorized';
      if (request.signal.aborted) return 'renewal_required';
      const snapshot = consentSnapshot(request);
      if (!snapshot) return 'renewal_required';
      if (approved.get(request.operationRunId) === snapshot)
        return 'authorized';

      // An approval for a superseded payload is revoked before asking about its replacement.
      approved.delete(request.operationRunId);
      let confirmed = false;
      try {
        confirmed = await confirm(request);
      } catch {
        return 'renewal_required';
      }
      if (
        !confirmed ||
        request.signal.aborted ||
        consentSnapshot(request) !== snapshot
      ) {
        return 'renewal_required';
      }
      approved.set(request.operationRunId, snapshot);
      return 'authorized';
    },
    clear(operationRunId) {
      if (operationRunId) approved.delete(operationRunId);
      else approved.clear();
    },
  };
}
