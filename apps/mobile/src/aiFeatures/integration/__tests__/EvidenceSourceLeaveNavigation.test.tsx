import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { referenceOnly } from '../testSupport/personalEvidenceTestSupport';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
  searchFixtureEvidence,
} from '../featureServiceFixtures';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { AiFeatureServiceDependencies } from '../featureServices';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('leaves a read-only citation without confirmation and ignores its late reread', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const record = memoryRecord(1);
  const source = localData([record]);
  let finishRead!: (records: PersistedMemoryRecord[]) => void;
  const pendingRead = new Promise<PersistedMemoryRecord[]>(resolve => {
    finishRead = resolve;
  });
  let blockViewerRead = false;
  // Saving now reads the cited source too; defer only the viewer's later read
  // so this test still observes leaving an in-flight read-only detail screen.
  const listRecords = jest.fn(async () =>
    blockViewerRead ? pendingRead : [record],
  );
  source.data.memoryStorage.listRecords =
    listRecords as typeof source.data.memoryStorage.listRecords;
  const ragRunner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      const reference = (await searchFixtureEvidence(options.workflow.tools))
        .items[0];
      if (!reference) throw new Error('Expected the local memory citation.');
      return {
        status: 'answer' as const,
        answer: '검토가 필요한 내용이에요.',
        citations: [referenceOnly(reference)],
      };
    },
  ) as unknown as typeof runRagConversationTurn;
  const route = await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      serviceDependencies={routeDependencies({
        ragRunner,
        loadLocalData: async () => source.data,
      })}
    />,
  );

  await fireEvent.changeText(
    route.getByTestId('rag-conversation-input'),
    '기록을 확인해 주세요.',
  );
  await fireEvent.press(route.getByTestId('rag-conversation-send'));
  const openSource = await route.findByLabelText(/원문 근거 열기/);
  const earlierReads = listRecords.mock.calls.length;
  blockViewerRead = true;
  await fireEvent.press(openSource);
  await waitFor(() =>
    expect(listRecords.mock.calls.length).toBeGreaterThan(earlierReads),
  );
  expect(route.getByTestId('ai-feature-source-loading')).toBeTruthy();

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(route.queryByTestId('ai-feature-source-detail')).toBeNull(),
  );
  await act(async () => finishRead([record]));
  expect(alert).not.toHaveBeenCalled();
  expect(route.queryByTestId('ai-feature-source-detail')).toBeNull();
  expect(route.getByText(/검토가 필요한 내용이에요./)).toBeTruthy();
});

function routeDependencies(
  overrides: Partial<AiFeatureServiceDependencies> = {},
): AiFeatureServiceDependencies {
  return {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([memoryRecord(1)]).data,
    ...overrides,
  };
}
