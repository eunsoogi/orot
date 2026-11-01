import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import type { NextVisitQuestionsRouteProps } from '../NextVisitQuestionsRoute.types';
import type { SelectedAiResolution } from '../provider';
import { useNextVisitQuestionsRoute } from '../useNextVisitQuestionsRoute';

test('an older provider lookup cannot replace the latest selection', async () => {
  const pending: ((value: SelectedAiResolution) => void)[] = [];
  const resolveSelectedAi = jest.fn(
    () => new Promise<SelectedAiResolution>(resolve => pending.push(resolve)),
  );
  const props = {
    selectedAiRevision: 0,
    resolveSelectedAi,
    operations: { loadAppointment: async () => null },
    loadSavedVisitQuestions: jest.fn(),
    onOpenProviderSelection: jest.fn(),
    confirmConsent: jest.fn(),
    resolveSource: jest.fn(),
    registerVisitQuestionSource: jest.fn(),
  } as unknown as NextVisitQuestionsRouteProps;
  const { result, rerender } = await renderHook(
    ({ revision }: { revision: number }) =>
      useNextVisitQuestionsRoute({ ...props, selectedAiRevision: revision }),
    { initialProps: { revision: 0 } },
  );
  await rerender({ revision: 1 });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1]!({ status: 'selection-required' }));
  const option = createAppleSelectionOption('available');
  await act(async () =>
    pending[0]!({
      status: 'ready',
      selection: { providerId: option.provider.id, modelId: option.modelId },
      option,
      provider: option.provider,
      modelId: option.modelId,
      recipient: '기기 안의 Apple Intelligence',
      remoteProcessing: false,
    }),
  );
  expect(result.current.provider.status).toBe('unselected');
});
