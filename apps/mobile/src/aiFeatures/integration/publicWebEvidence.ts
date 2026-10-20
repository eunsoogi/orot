import type {
  EvidenceBatch,
  EvidenceReference,
  EvidenceSearchTool,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { requireSelectedAi } from './provider';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { jsonByteLength, stableJson } from './evidenceUtils';
import {
  PUBLIC_WEB_SOURCE_ID,
  publicWebSources,
} from '../../externalMedicalEvidence/publicWebSources';
import { publicWebSearchConsentScope } from '../../agent/execution/inferenceConsentScopes';

import {
  parsePublicWebQuery,
  publicWebQuerySchema,
} from '../../agent/execution/publicWebQuery';

/** Keep the selected public-search request isolated from private model history.
 * Topic queries are app-owned; unclassified free text needs one-time review. */
export function createPublicWebEvidence(input: {
  readonly selected: ReturnType<typeof requireSelectedAi>;
  readonly consent: ExecutionConsentPort;
  readonly now?: () => string;
}) {
  const { selected, consent } = input;
  const search = selected.provider.searchPublicWeb;
  if (!selected.remoteProcessing || !search) return undefined;
  const references = new Set<string>();
  let sequence = 0;
  const tool: EvidenceSearchTool = {
    id: 'public-web-search',
    sourceKind: 'external_medical',
    execution: 'external_read_only',
    additionalModelCalls: 1,
    description:
      'Search the general public web beyond Europe PMC with the selected account/model. Prefer app-owned topics to reuse public-search permission; use query only when those topics are insufficient and request explicit review. Output is a cited model explanation, not original source passages.',
    inputSchema: publicWebQuerySchema,
    parseInput: parsePublicWebQuery,
    async search(request) {
      const parsed = parsePublicWebQuery(request.input);
      const scoped = () =>
        request.allowedScope.sourceKinds.includes('external_medical') &&
        request.allowedScope.timeRange === undefined &&
        (!request.allowedScope.sourceIds ||
          request.allowedScope.sourceIds.includes(PUBLIC_WEB_SOURCE_ID));
      if (
        !parsed ||
        !scoped() ||
        !Number.isSafeInteger(request.resultLimit) ||
        request.resultLimit < 1
      ) {
        throw new Error('The public web query or source scope was invalid.');
      }
      const query = parsed.query as string;
      if (request.signal.aborted) return { status: 'consent_required' };
      const approved = await consent.authorize({
        operationRunId: request.operationRunId,
        providerId: selected.provider.id,
        modelId: selected.modelId,
        recipient: `${selected.recipient} · 공개 웹검색`,
        remoteProcessing: true,
        consentScope: publicWebSearchConsentScope,
        allowedScope: {
          sourceKinds: ['external_medical'],
          sourceIds: [PUBLIC_WEB_SOURCE_ID],
        },
        payload: { messages: [{ role: 'user', content: query }] },
        signal: request.signal,
      });
      if (approved !== 'authorized' || request.signal.aborted || !scoped())
        return { status: 'consent_required' };
      const result = await search.call(
        selected.provider,
        { query },
        { signal: request.signal },
      );
      if (request.signal.aborted)
        throw new Error('Public web search was cancelled.');
      if (!result.ok)
        throw new Error(
          'The selected model could not return cited public web evidence.',
        );
      const response = result.value;
      if (
        !response.text.trim() ||
        !Number.isSafeInteger(response.callCount) ||
        response.callCount < 1 ||
        response.callCount > 2
      ) {
        throw new Error('The public web response was invalid.');
      }
      const at = (input.now ?? (() => new Date().toISOString()))();
      const item = {
        sourceKind: 'external_medical' as const,
        sourceId: PUBLIC_WEB_SOURCE_ID,
        sourceRevision: `retrieved:${at}`,
        evidenceId: `web-result-${++sequence}`,
        evidenceRevision: `snapshot:${at}:${sequence}`,
        effectiveTime: null,
        reviewState: 'unknown' as const,
        locator: {
          kind: 'public_web_search',
          provider: 'ChatGPT web search',
          title: '공개 웹검색',
          retrievedAt: at,
          revisionBasis: 'retrieval_snapshot',
          sources: response.citations.map(source => ({
            title: source.title,
            url: source.url,
          })),
        },
        content: `Provenance: model-generated explanation from a bounded public web search, not original source passages or personal findings.\n${response.text}`,
      };
      if (!publicWebSources(item))
        throw new Error('Public web source links were invalid.');
      const batch: EvidenceBatch = {
        items: [item],
        conflicts: [],
        coverage: [
          {
            sourceKind: 'external_medical',
            searchedSourceIds: [PUBLIC_WEB_SOURCE_ID],
            gaps: [],
            truncated: true,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
      };
      if (jsonByteLength(batch) > request.maxPayloadBytes)
        throw new Error('Public web evidence exceeded the payload bound.');
      references.add(stableJson(referenceOnly(item)));
      return batch;
    },
  };
  return {
    tool,
    validates: (reference: EvidenceReference) =>
      references.has(stableJson(reference)),
  };
}
