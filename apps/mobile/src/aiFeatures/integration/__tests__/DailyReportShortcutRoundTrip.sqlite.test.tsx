import { fireEvent, screen, waitFor } from '@testing-library/react-native';
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
import type { AiFeatureLocalData } from '../localData';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../openDailyReportDatabase');

test('real Daily shortcut writes its protected report and reopens the same template without regeneration', async () => {
  const generate = jest.fn().mockResolvedValue({
    ok: true,
    value: { text: '{"indexes":[0]}', toolCalls: [], finishReason: 'complete' },
  });
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

    await fireEvent.press(screen.getByTestId('daily-report-request'));

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
  } finally {
    await feature.close();
  }
});
