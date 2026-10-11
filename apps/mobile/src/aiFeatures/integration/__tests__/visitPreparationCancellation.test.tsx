import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Appointment } from '@orot/domain';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import type { SelectedAiResolution } from '../provider';
import { useNextVisitQuestionsRoute } from '../useNextVisitQuestionsRoute';
import type { NextVisitQuestionsRouteProps } from '../NextVisitQuestionsRoute.types';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { prepareUpcomingVisitQuestionContext } from '../../../agent/visitQuestions/localContext';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';

jest.mock('../visitQuestionsContextLoader', () => ({
  loadVisitQuestionsContext: async () =>
    require('../../../agent/visitQuestions/localContext'),
}));

jest.mock('../../../agent/visitQuestions/localContext', () => ({
  prepareUpcomingVisitQuestionContext: jest.fn(),
}));
jest.mock('../../../agent/visitQuestions/workflow', () => ({
  runVisitQuestionWorkflow: jest.fn(),
}));

const option = createAppleSelectionOption('available');
const selection = { providerId: option.provider.id, modelId: option.modelId };
const ready: Extract<SelectedAiResolution, { status: 'ready' }> = {
  status: 'ready',
  option,
  provider: option.provider,
  selection,
  modelId: selection.modelId,
  recipient: 'device',
  remoteProcessing: false,
};
// The route only forwards this appointment during the cancellation boundary under test.
const appointment = { id: 'synthetic-visit' } as Appointment;

test('cancel during provider resolution prevents late provider state changes and inference', async () => {
  let release!: (value: SelectedAiResolution) => void;
  const waiting = new Promise<SelectedAiResolution>(resolve => {
    release = resolve;
  });
  const resolveSelectedAi = jest
    .fn(async () => ready as SelectedAiResolution)
    .mockResolvedValueOnce(ready)
    .mockImplementationOnce(() => waiting);
  const generate = jest.fn(async () => ({ status: 'cancelled' as const }));
  const props: NextVisitQuestionsRouteProps = {
    onBack: jest.fn(),
    onOpenProviderSelection: jest.fn(),
    onOpenSource: jest.fn(),
    onRouteStateChange: jest.fn(),
    resolveSelectedAi,
    confirmConsent: async () => true,
    resolveSource: () => undefined,
    registerVisitQuestionSource: jest.fn(),
    selectedAiRevision: 0,
    loadSavedVisitQuestions: async () => ({
      status: 'ready',
      appointmentId: appointment.id,
      questions: [],
      caveats: [],
      restorationNotice: '',
    }),
    operations: {
      loadAppointment: async () => null,
      generate,
      save: jest.fn(),
    },
  };
  const { result } = await renderHook(() => useNextVisitQuestionsRoute(props));
  await waitFor(() => expect(result.current.provider.status).toBe('available'));
  const controller = new AbortController();
  let pending!: ReturnType<typeof result.current.onGenerate>;
  await act(async () => {
    pending = result.current.onGenerate(
      appointment,
      selection,
      controller.signal,
    );
  });
  await act(async () => {
    controller.abort();
  });
  await expect(pending).resolves.toEqual({ status: 'cancelled' });
  await act(async () => {
    release({ status: 'selection-required' });
  });
  expect(result.current.provider.status).toBe('available');
  expect(generate).not.toHaveBeenCalled();
});

test('passes cancellation into local preparation and never starts a late workflow', async () => {
  let release!: (value: { status: 'cancelled' }) => void;
  const waiting = new Promise<{ status: 'cancelled' }>(resolve => {
    release = resolve;
  });
  jest.mocked(prepareUpcomingVisitQuestionContext).mockReturnValue(waiting);
  const controller = new AbortController();
  const pending = defaultVisitQuestionRouteOperations.generate({
    appointment,
    selectedAi: ready,
    confirmConsent: async () => true,
    signal: controller.signal,
  });
  await waitFor(() =>
    expect(prepareUpcomingVisitQuestionContext).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    ),
  );
  controller.abort();
  release({ status: 'cancelled' });
  await expect(pending).resolves.toEqual({ status: 'cancelled' });
  expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
});
