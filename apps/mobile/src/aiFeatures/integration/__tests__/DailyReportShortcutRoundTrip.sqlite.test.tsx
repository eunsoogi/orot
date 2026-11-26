import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  createRecordRepository,
  createManualHistoryRepository,
} from '@orot/storage';
import { createMountedShortcutRoundTrip } from '../testSupport/mountedShortcutRoundTrip';
import { createAiFeatureServices } from '../featureServices';
import { apple, localData, selectionStore } from '../featureServiceFixtures';
import { openDailyReportDatabase } from '../openDailyReportDatabase';

import { reportObservation } from '../testSupport/dailyReportFailureStageFixtures';
import { dailyConversationReportHeadings } from '../../../ragConversation/dailyConversationReportTemplate';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import {
  providerSuccess,
  type LanguageModelExecutionOptions,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import type { AiFeatureLocalData } from '../localData';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../openDailyReportDatabase');

function held() {
  let release!: () => void;
  const done = new Promise<void>(resolve => {
    release = resolve;
  });
  return { done, release };
}

test('real Daily shortcut separates lookup, dispatch, verified receipt and visible Read before durable reopen', async () => {
  const lookup = held();
  const completion = held();
  const milestones: { stage: string; elapsed: number }[] = [];
  const started = performance.now();
  const mark = (stage: string) =>
    milestones.push({ stage, elapsed: performance.now() - started });
  const stages = () => milestones.map(item => item.stage);
  let acknowledge: (() => void) | undefined;
  const generate = jest.fn(
    async (
      request: LanguageModelRequest,
      options?: LanguageModelExecutionOptions,
    ) => {
      const message = request.messages.find(item => item.role === 'user');
      let facts: unknown;
      try {
        if (message?.role === 'user' && typeof message.content === 'string')
          facts = JSON.parse(message.content).facts;
      } catch {
        /* The optional opening is plain text. */
      }
      if (!Array.isArray(facts))
        return providerSuccess({
          text: '',
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      mark('provider-dispatch');
      acknowledge = options?.onResponseStarted;
      await completion.done;
      mark('final-output');
      return providerSuccess({
        text: '{"indexes":[0]}',
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    },
  );
  const provider = { ...apple.provider, generate, stream: undefined };
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const feature = await createMountedShortcutRoundTrip(async database => {
    const repository = createRecordRepository(database);
    const now = new Date(Date.now() - 1000).toISOString();
    if (!(await repository.get('health_observation', reportObservation.id)))
      await repository.put('health_observation', {
        ...reportObservation,
        effectiveAt: now,
        recordedAt: now,
        ingestedAt: now,
      });
    jest.mocked(openDailyReportDatabase).mockResolvedValue(database);
    const selection = { providerId: provider.id, modelId: apple.modelId };
    const data: AiFeatureLocalData = {
      ...localData([]).data,
      repository: {
        ...localData([]).data.repository,
        readRecord: repository.get.bind(repository),
      },
      manualHistory: createManualHistoryRepository(database),
      openConversationArtifactStorage: async () =>
        createConversationArtifactStorage(database),
      summaryArtifactDiscovery: async registry =>
        createSummaryArtifactDiscovery({
          database,
          storage: createSymptomSummaryStorage(database),
          registry,
          data,
        }),
    };
    const dependencies = {
      selectedAi: {
        selectionStore: selectionStore(selection),
        loadAppleOption: async () => ({ ...apple, provider }),
      },
      loadLocalData: async () => data,
    };
    return {
      services: createAiFeatureServices(consent, dependencies),
      dependencies,
      consent,
    };
  });
  try {
    await feature.mount();

    const database = feature.database();
    jest.mocked(openDailyReportDatabase).mockImplementationOnce(async () => {
      mark('lookup-entered');
      await lookup.done;
      mark('lookup-unblocked');
      return database;
    });
    mark('tap');
    await fireEvent.press(screen.getByTestId('daily-report-request'));
    await waitFor(() => expect(stages()).toEqual(['tap', 'lookup-entered']));
    const outgoing = () => screen.getByTestId('conversation-message-receipt');
    expect(outgoing()).toHaveTextContent(/전송 중/);
    expect(generate).not.toHaveBeenCalled();

    await act(async () => lookup.release());
    await waitFor(() => expect(acknowledge).toBeDefined());
    expect(stages()).toEqual([
      'tap',
      'lookup-entered',
      'lookup-unblocked',
      'provider-dispatch',
    ]);
    expect(outgoing()).toHaveTextContent(/보냄/);
    expect(outgoing()).not.toHaveTextContent(/읽음/);

    await act(async () => {
      mark('verified-response-start');
      acknowledge!();
    });
    await waitFor(() => expect(outgoing()).toHaveTextContent(/읽음/));
    mark('mounted-read');
    expect(screen.queryByText('오늘 기록의 흐름')).toBeNull();
    expect(stages()).not.toContain('final-output');
    await act(async () => completion.release());

    const heading = '오늘 기록의 흐름';
    expect(await screen.findByText(heading)).toBeVisible();

    await waitFor(async () =>
      expect(await feature.storage().listCompletionIdentities()).toHaveLength(
        1,
      ),
    );

    const expectedHeadings = dailyConversationReportHeadings().filter(label =>
      screen.queryByText(label),
    );
    expect(expectedHeadings.length).toBeGreaterThan(0);
    const observation = /오늘 기록된 심박수: 72/;
    expect(screen.getByText(observation)).toBeVisible();
    const attempts = generate.mock.calls.length;
    expect(attempts).toBeGreaterThan(0);
    expect(await feature.storage().listCompletionIdentities()).toHaveLength(1);
    await feature.reopen();
    expect(await screen.findByText(heading)).toBeVisible();
    expect(screen.getByText(observation)).toBeVisible();
    for (const label of expectedHeadings)
      expect(screen.getByText(label)).toBeVisible();
    expect(generate).toHaveBeenCalledTimes(attempts);
    expect(stages()).toEqual([
      'tap',
      'lookup-entered',
      'lookup-unblocked',
      'provider-dispatch',
      'verified-response-start',
      'mounted-read',
      'final-output',
    ]);
    expect(
      milestones.every(
        (item, index) =>
          index === 0 || item.elapsed >= milestones[index - 1]!.elapsed,
      ),
    ).toBe(true);
  } finally {
    lookup.release();
    completion.release();
    await feature.close();
  }
});
