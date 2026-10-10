import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';
import { navigationText } from '../../../i18n/navigation';
import { NextVisitQuestionsRoute } from '../NextVisitQuestionsRoute';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { AiFeatureServiceDependencies } from '../featureServices';
import type {
  VisitQuestionRouteGeneration,
  VisitQuestionRouteOperations,
} from '../visitQuestionsRouteOperations';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const selection = {
  providerId: apple.provider.id,
  modelId: apple.modelId,
};
const appointment = {
  id: 'synthetic-visit-1',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  status: 'scheduled' as const,
  calendarEventIdentifier: 'synthetic-calendar-event',
  calendarEventSnapshot: {
    title: '합성 예약',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
};

jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

afterEach(() => jest.restoreAllMocks());

test('asks before aborting pending visit-question generation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signal: AbortSignal | undefined;
  const operations = createOperations(({ signal: requestSignal }) => {
    signal = requestSignal;
    return new Promise(resolve => {
      requestSignal.addEventListener(
        'abort',
        () => resolve({ status: 'cancelled' }),
        { once: true },
      );
    });
  });
  const route = await renderIntegratedRoute(operations);
  await startGeneration(route);

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveOngoingOperation.title,
  );
  await pressAlertButton(alert, 0);
  expect(signal?.aborted).toBe(false);
  expect(route.getByTestId('next-visit-generation-loading')).toBeTruthy();

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(route.queryByTestId('next-visit-questions-scroll')).toBeNull(),
  );
  expect(signal?.aborted).toBe(true);
});

test('rejects a leave confirmation when generation finishes while it is open', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let finish!: (outcome: VisitQuestionRouteGeneration) => void;
  const operations = createOperations(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const route = await renderIntegratedRoute(operations);
  await startGeneration(route);
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));

  await act(async () => {
    finish({ status: 'unavailable', message: '합성 생성 결과' });
  });
  await waitFor(() =>
    expect(route.getByTestId('next-visit-generation-message')).toBeTruthy(),
  );
  await pressAlertButton(alert, 1);

  expect(route.getByTestId('next-visit-questions-scroll')).toBeTruthy();
});

function createOperations(
  generate: VisitQuestionRouteOperations['generate'],
): VisitQuestionRouteOperations {
  return {
    loadAppointment: jest.fn(async () => appointment),
    generate: jest.fn(generate),
    save: jest.fn(async input => ({
      questions: input.questions,
      caveats: input.caveats,
      memoryStatus: 'saved' as const,
      validateSource: async () => true,
    })),
  };
}

async function renderIntegratedRoute(operations: VisitQuestionRouteOperations) {
  const data = localData([memoryRecord(1)]).data;
  const serviceDependencies: AiFeatureServiceDependencies = {
    selectedAi: {
      selectionStore: selectionStore(selection),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => data,
  };
  return render(
    <AiFeatureRoute
      onBack={jest.fn()}
      renderVisitQuestions={input => (
        <NextVisitQuestionsRoute
          {...input}
          loadSavedVisitQuestions={async appointmentId => ({
            status: 'ready' as const,
            appointmentId,
            questions: [],
            caveats: [],
            restorationNotice: '합성 복원 결과',
          })}
          operations={operations}
        />
      )}
      serviceDependencies={serviceDependencies}
    />,
  );
}

async function startGeneration(route: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));
  await waitFor(() => expect(route.getByText('합성 예약')).toBeTruthy());
  await waitFor(() =>
    expect(route.getByTestId('next-visit-provider-select')).toHaveTextContent(
      /Apple Intelligence/u,
    ),
  );
  await fireEvent.press(route.getByTestId('next-visit-generate'));
  await waitFor(() =>
    expect(route.getByTestId('next-visit-generation-loading')).toBeTruthy(),
  );
}

/** Uses the native confirmation callback to resume the shared navigation guard. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
