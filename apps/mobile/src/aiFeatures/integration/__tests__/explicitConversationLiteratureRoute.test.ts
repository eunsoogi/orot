import type { ConversationWorkflowContinuation } from '../../../ragConversation/conversationWorkflowContinuation';
import { conversationIntentRequests } from '../conversationIntent';
import { conversationPublicSearchPlan } from '../conversationPublicSearchPlan';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { createSettingsConsentAuthorization } from '../../../agent/execution/settingsConsentAuthorization';
import { publicMedicalQueryConsent } from '../../../agent/execution/publicMedicalQueryConsent';
import { publicSearchSettingsPermissions } from '../../../agent/execution/settingsConsentCatalog';
import { explicitConversationLiteratureRoute } from '../explicitConversationLiteratureRoute';
import { readColdConversationSearch } from '../coldConversationSearch';

const sourcedQuestion = '수면에 관한 Europe PMC 의학 논문을 찾아 주세요.';
const pmcId = 'europe-pmc-publication-search';

test.each([
  [sourcedQuestion, true],
  ['Europe PMC가 궁금해요.', false],
  ['Europe PMC 말고 ChatGPT 웹 검색으로 논문을 검색해 주세요.', false],
  ['Europe PMC 논문과 웹 검색 결과를 비교해 주세요.', false],
  ['Europe PMC 논문을 검색하지 마세요.', false],
  ['최근 수면 기록을 웹 검색으로 설명해 주세요.', false],
] as const)(
  'only positive specific literature intent opts out of native Web: %s',
  (request, expected) =>
    expect(explicitConversationLiteratureRoute(request)).toBe(expected),
);

test.each(['current', 'missing', 'revoked', 'raw'] as const)(
  'separate exact PMC grant controls explicit literature (%s)',
  async mode => {
    const permitted = mode === 'current';
    let ownerCurrent = true;
    const f = publicEvidenceFixture();
    // Standalone explicit study search may have an independent PMC grant but no
    // native hosted-search grant. Neither provider receives free-form question text.
    f.authorize.mockResolvedValue('renewal_required');
    const identity = {
      providerId: 'europe-pmc',
      modelId: 'public-medical-search',
      recipient: 'Europe PMC',
      authorityGeneration: 'synthetic-generation',
      credentialEpoch: 'synthetic-owner',
    };
    const pmcConsent = createSettingsConsentAuthorization({
      catalogVersion: 'model-settings-v1',
      resolveOwner: async () => ({
        slot: 'conversation',
        domain: 'medical-search',
        identity,
        isCurrent: () => ownerCurrent,
      }),
      readGrant: async () => {
        if (mode === 'revoked') ownerCurrent = false;
        return mode !== 'missing'
          ? {
              version: 1,
              catalogVersion: 'model-settings-v1',
              identity,
              permissions: [publicSearchSettingsPermissions.medical],
            }
          : null;
      },
    });
    const europePmc = jest.fn(async () => ({ status: 'empty' as const }));
    type Run =
      typeof import('../../../ragConversation/service').runRagConversationTurn;
    const runner = jest.fn<ReturnType<Run>, Parameters<Run>>(async options => {
      const tool = options.workflow.tools.find(value => value.id === pmcId);
      expect(tool).toBeDefined();
      expect(
        options.workflow.tools.some(value => value.id === 'public-web-search'),
      ).toBe(false);
      if (mode === 'raw') {
        const input = { query: 'synthetic-private' };
        expect(tool!.parseInput?.(input)).toBeUndefined();
        await expect(tool!.search({ ...f.request, input })).rejects.toThrow(
          'The public literature topics were invalid.',
        );
      } else {
        const result = await tool!.search(f.request);
        if (permitted) expect(result).toMatchObject({ items: [] });
        else expect(result).toEqual({ status: 'consent_required' });
      }
      return { status: 'no_evidence' };
    });
    const send = createRagConversationService({
      selectedAi: async () => f.selected,
      consent: f.consent,
      queryConsent: publicMedicalQueryConsent(pmcConsent),
      externalEvidence: { search: europePmc },
      loadLocalData: async () => localData([]).data,
      registry: new LocalEvidenceReferenceRegistry(),
      ragRunner: runner,
    });
    const result = await send(
      sourcedQuestion + ' synthetic-private',
      [],
      f.controller.signal,
    );
    expect(result).toEqual({ status: 'no_evidence' });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.search).not.toHaveBeenCalled();
    expect(europePmc).toHaveBeenCalledTimes(permitted ? 1 : 0);
    if (permitted)
      expect(JSON.stringify(europePmc.mock.calls)).not.toContain(
        'synthetic-private',
      );
  },
);

test('cold route marker does not reinterpret older snapshots or allow charged literature-only mode', () => {
  const base = { version: 1, status: 'unavailable', charged: false };
  expect(readColdConversationSearch({ publicSearch: base })).toEqual(base);
  expect(
    readColdConversationSearch({
      invocation: { request: sourcedQuestion },
      publicSearch: { ...base, literatureOnly: true },
    }),
  ).toEqual({ ...base, literatureOnly: true });
  expect(() =>
    readColdConversationSearch({
      invocation: { request: '웹 검색' },
      publicSearch: { ...base, literatureOnly: true },
    }),
  ).toThrow();
  expect(() =>
    readColdConversationSearch({
      publicSearch: { ...base, literatureOnly: true, charged: true },
    }),
  ).toThrow();
});

test('typed standalone literature skips even retained native preflight', async () => {
  const f = publicEvidenceFixture();
  const prepare = jest.fn();
  const lookup = jest.fn();
  const question = conversationIntentRequests['medical-literature'];
  expect(explicitConversationLiteratureRoute(question)).toBe(false);
  const plan = await conversationPublicSearchPlan({
    question,
    entryIntent: 'medical-literature',
    runId: 'synthetic-retained',
    signal: f.controller.signal,
    external: {
      publicWebTool: {
        id: 'public-web-search',
        search: lookup,
        prepareAuthorizedSearch: prepare,
      },
    } as unknown as Parameters<
      typeof conversationPublicSearchPlan
    >[0]['external'],
    continuation: {} as ConversationWorkflowContinuation,
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
  expect(plan.initialSearch).toBeUndefined();
  expect(plan.chargeEagerSearch).toBe(false);
  expect(plan.toolPolicy).toEqual({
    publicSearchSucceeded: false,
    literatureOnly: true,
  });
  expect(
    readColdConversationSearch({
      invocation: {
        request: question,
        context: { intent: 'medical-literature' },
      },
      publicSearch: plan.coldSearch!,
    }),
  ).toEqual({
    version: 1,
    status: 'unavailable',
    charged: false,
    literatureOnly: true,
  });
});
