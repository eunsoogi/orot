import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';
import { HealthReviewSessionProvider } from '../HealthReviewSession';
import { HealthReviewScreen } from '../HealthReviewScreen';
import { createHealthReviewService } from '../service';
import { runLocalHealthReview } from '../../agent/healthReview/workflow';
import { healthReviewText as copy } from '../../i18n/healthReview';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { mapBloodPressureCorrelation } from '../../healthkit/bloodPressure/mapper';
import { correlation } from '../../healthkit/bloodPressure/testSupport';
import { healthReviewSqlite, instant } from '../testing/sqlite';
import { withFixedDate } from '../../agent/healthReview/testing/currentPeriodEvidenceFixture';

jest.mock('../../agent/polyfills', () => ({}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: async () => 'authorized' },
    disclosureSheet: null,
  }),
}));

async function seedHealthKitBloodPressure(
  repository: Awaited<ReturnType<typeof healthReviewSqlite>>['repository'],
) {
  const sample = correlation('healthkit-pressure-correlation');
  const timed = {
    ...sample,
    startDate: instant,
    endDate: instant,
    components: sample.components?.map(component => ({
      ...component,
      startDate: instant,
      endDate: instant,
    })),
  };
  for (const observation of mapBloodPressureCorrelation(timed, instant)
    .observations)
    await repository.put('health_observation', observation);
}

// Keep only provider output synthetic; the form, evidence collection and graph stay real.
function healthReviewResponse(request: LanguageModelRequest) {
  const user = request.messages.find(message => message.role === 'user');
  if (!user || user.role !== 'user' || typeof user.content !== 'string')
    throw new Error('Expected the health-review evidence prompt.');
  const prompt = JSON.parse(user.content) as {
    evidence: { items: { evidenceId: string }[] };
  };
  const ids = prompt.evidence.items.map(item => item.evidenceId);
  if (!ids.length) throw new Error('No local evidence reached the provider.');
  return providerSuccess({
    text: JSON.stringify({
      type: 'result',
      citations: ids,
      value: {
        observedChanges: [
          { text: '가져온 건강 기록을 확인했어요.', evidenceIds: ids },
        ],
        unresolvedItems: [],
        questions: ['이 기록을 의료진과 함께 확인할까요?'],
      },
    }),
    toolCalls: [],
    finishReason: 'complete',
  });
}

function syntheticHealthReviewProvider(
  generate: LanguageModelProvider['generate'],
): LanguageModelProvider {
  return {
    id: 'synthetic-health-review-provider',
    kind: 'language-model',
    displayName: 'Synthetic health review',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
}

function selectedHealthReviewProvider(
  modelProvider: LanguageModelProvider,
): SelectedAiResolution {
  return {
    status: 'ready',
    selection: { providerId: modelProvider.id, modelId: 'synthetic' },
    option: {
      provider: modelProvider,
      modelId: 'synthetic',
      displayName: modelProvider.displayName,
      privacyBoundary: 'on-device',
      availability: { status: 'available' },
    },
    provider: modelProvider,
    modelId: 'synthetic',
    recipient: 'on-device',
    remoteProcessing: false,
  };
}

describe('record observation through the real form, service, graph and HealthKit evidence tools', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;

  beforeEach(async () => {
    f = await healthReviewSqlite();
    await f.seed();
    await seedHealthKitBloodPressure(f.repository);
    jest.mocked(openLocalStorage).mockResolvedValue(f.repository);
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) =>
          require('node:crypto').randomFillSync(bytes),
      },
    });
  });

  afterEach(() => f.close());

  async function renderForm(modelProvider: LanguageModelProvider) {
    const selected = selectedHealthReviewProvider(modelProvider);
    const service = createHealthReviewService({
      resources: async () => ({
        repository: f.repository,
        requests: f.requests,
      }),
      resolveSelected: async () => selected,
      data: async () => f.data,
      run: runLocalHealthReview,
    });
    await render(
      <HealthReviewSessionProvider service={service}>
        <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
      </HealthReviewSessionProvider>,
    );
    await fireEvent.changeText(
      screen.getByTestId('health-review-name'),
      '최근 건강 기록',
    );
    await fireEvent.press(
      screen.getByRole('radio', {
        name: '대상 정보: 임신 중이 아닌 성인',
      }),
    );
    await fireEvent.press(
      screen.getByRole('radio', {
        name: '현재 증상 확인: 새롭거나 걱정되는 증상이 없음',
      }),
    );
    return service;
  }

  it('reviews imported observations while preserving the unresolved blood-pressure policy input', async () =>
    withFixedDate(instant, async () => {
      let providerRequest: LanguageModelRequest | undefined;
      const modelProvider = syntheticHealthReviewProvider(async request => {
        providerRequest = request;
        return healthReviewResponse(request);
      });
      await renderForm(modelProvider);
      await fireEvent.press(screen.getByTestId('health-review-start'));

      expect(
        await screen.findByTestId('health-review-result'),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(copy.outcomes.needs_clarification),
      ).toBeOnTheScreen();
      expect(screen.getByText(/혈압 측정 기록/)).toBeOnTheScreen();
      expect(
        screen.getByText(copy.actions.provide_required_information),
      ).toBeOnTheScreen();
      expect(
        screen.getByText('가져온 건강 기록을 확인했어요.'),
      ).toBeOnTheScreen();
      expect(providerRequest).toBeDefined();
      const requestText = JSON.stringify(providerRequest);
      expect(requestText.toLowerCase()).toContain('blood pressure');
      expect(requestText).not.toContain('user-entered cuff');
      expect(await f.repository.list('health_observation')).toHaveLength(3);
    }));

  it('keeps an in-flight cancellation terminal when the real service receives a late response', async () =>
    withFixedDate(instant, async () => {
      let providerRequest: LanguageModelRequest | undefined;
      let markProviderStarted!: () => void;
      const providerStarted = new Promise<void>(resolve => {
        markProviderStarted = resolve;
      });
      let releaseResponse!: (
        result: Awaited<ReturnType<LanguageModelProvider['generate']>>,
      ) => void;
      const delayedResponse = new Promise<
        Awaited<ReturnType<LanguageModelProvider['generate']>>
      >(resolve => {
        releaseResponse = resolve;
      });
      const modelProvider = syntheticHealthReviewProvider(async request => {
        providerRequest = request;
        markProviderStarted();
        return delayedResponse;
      });
      const service = await renderForm(modelProvider);
      const start = service.start.bind(service);
      let serviceRun: ReturnType<typeof service.start> | undefined;
      service.start = (...args) => {
        serviceRun = start(...args);
        return serviceRun;
      };
      const importedBefore = await f.repository.list('health_observation');

      await fireEvent.press(screen.getByTestId('health-review-start'));
      await providerStarted;

      // Release the real graph only after the visible screen has cancelled it.
      await fireEvent.press(screen.getByTestId('health-review-cancel'));
      expect(
        await screen.findByTestId('health-review-cancelled'),
      ).toBeOnTheScreen();

      let execution: Awaited<ReturnType<typeof service.start>> | undefined;
      await act(async () => {
        releaseResponse(healthReviewResponse(providerRequest!));
        execution = await serviceRun;
      });
      expect(execution?.result).toEqual({ status: 'cancelled' });
      expect(screen.getByTestId('health-review-cancelled')).toBeOnTheScreen();
      expect(screen.queryByTestId('health-review-result')).toBeNull();
      expect(await f.repository.list('health_observation')).toEqual(
        importedBefore,
      );
    }));
});
