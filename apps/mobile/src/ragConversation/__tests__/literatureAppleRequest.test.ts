import { APPLE_PROVIDER_CAPABILITIES } from '@orot/provider-apple';
import { buildTaskRequest } from '../../../../../packages/agent-runtime/src/multiAgent/requests';
import { serializeAppleRequest } from '../../providers/apple/serializeRequest';
import { ragConversationTask } from '../task';

test('the shipping Apple serializer accepts the literature response schema', async () => {
  const provider = {
    kind: 'language-model' as const,
    id: 'apple-foundation-models',
    displayName: 'Apple',
    capabilities: APPLE_PROVIDER_CAPABILITIES,
    generate: async () => {
      throw new Error('No model call');
    },
  };
  const budget = {
    maxModelCalls: 4,
    maxToolCalls: 4,
    maxResearchCycles: 1,
    maxPayloadBytes: 65536,
    maxOutputTokens: 1024,
    timeoutMs: 45000,
    maxEvidenceItems: 5,
  };
  const built = await buildTaskRequest(
    provider,
    ragConversationTask,
    {
      request: '문헌을 설명해 주세요.',
      evidence: {
        items: [
          {
            sourceKind: 'external_medical',
            sourceId: 'europe-pmc',
            sourceRevision: 'r1',
            evidenceId: 'paper',
            evidenceRevision: 'e1',
            locator: {},
            effectiveTime: null,
            reviewState: 'unknown',
            content: 'Abstract: sample.',
          },
        ],
        coverage: [],
        conflicts: [],
      },
    },
    budget,
  );
  expect(built.status).toBe('ready');
  if (built.status !== 'ready') return;
  const native = serializeAppleRequest(built.request);
  expect(native.mode).toBe('structured');
  expect(JSON.stringify(native.schema)).toContain('statisticSpan');
  expect(JSON.stringify(native.schema)).toContain('literature');
});

test('exposes literature fields only when a current Europe PMC item exists', () => {
  const personal = {
    sourceKind: 'personal_record' as const,
    sourceId: 'record',
    sourceRevision: 'r1',
    evidenceId: 'local',
    evidenceRevision: 'e1',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
    content: 'record',
  };
  const paper = {
    ...personal,
    sourceKind: 'external_medical' as const,
    sourceId: 'europe-pmc',
    evidenceId: 'paper',
  };
  const input = (items: (typeof personal | typeof paper)[]) => ({
    request: '질문',
    evidence: { items, coverage: [], conflicts: [] },
  });
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input([personal]))),
  ).not.toContain('statisticSpan');
  expect(
    JSON.stringify(
      ragConversationTask.createResultSchema?.(input([personal, paper])),
    ),
  ).toContain('statisticSpan');
});

test('the mixed-evidence request carries source revisions without exposing the personal source identifier', async () => {
  const local = {
    sourceKind: 'personal_record' as const,
    sourceId: 'private-source-id',
    sourceRevision: 'local-revision',
    evidenceId: 'local-alias',
    evidenceRevision: 'item-revision',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
    content: '기록 원문',
  };
  const paper = {
    ...local,
    sourceKind: 'external_medical' as const,
    sourceId: 'europe-pmc',
    sourceRevision: 'paper-revision',
    evidenceId: 'MED:1',
    content: 'Abstract: Public source.',
  };
  const provider = {
    kind: 'language-model' as const,
    id: 'apple-foundation-models',
    displayName: 'Apple',
    capabilities: APPLE_PROVIDER_CAPABILITIES,
    generate: async () => {
      throw new Error('No model call');
    },
  };
  const budget = {
    maxModelCalls: 4,
    maxToolCalls: 4,
    maxResearchCycles: 1,
    maxPayloadBytes: 65536,
    maxOutputTokens: 1024,
    timeoutMs: 45000,
    maxEvidenceItems: 5,
  };
  const built = await buildTaskRequest(
    provider,
    ragConversationTask,
    {
      request: '내 기록과 문헌을 알려줘',
      evidence: { items: [local, paper], coverage: [], conflicts: [] },
    },
    budget,
  );
  expect(built.status).toBe('ready');
  if (built.status !== 'ready') return;
  const native = serializeAppleRequest(built.request);
  expect(JSON.stringify(native.schema)).toContain('localClaims');
  expect(native.prompt).toContain('local-revision');
  expect(native.prompt).toContain('paper-revision');
  expect(native.prompt).not.toContain('private-source-id');
});
