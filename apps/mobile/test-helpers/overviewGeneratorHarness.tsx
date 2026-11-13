import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import App from '../App';
import { createAppointmentStore } from './appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../src/appointmentReminders/AppointmentReminderContext';
import { RetainedVisitModuleHarness } from '../src/aiFeatures/integration/testSupport/RetainedVisitModuleHarness';
import { renderVisitQuestionsRoute } from '../src/routes/OverviewVisitQuestionsRoute';
import { savedOverviewQuestions as mockSavedHomeQuestions } from './overviewFixtures';
import { defaultVisitQuestionRouteOperations as defaults } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import {
  appointment,
  readyQuestions,
} from '../src/aiFeatures/integration/testSupport/visitQuestionsRetentionFixtures';

const mockSaved = new Map<string, string[]>();
jest.mock('../src/aiFeatures/integration/featureServices', () => {
  const actual = jest.requireActual(
    '../src/aiFeatures/integration/featureServices',
  );
  return {
    ...actual,
    createAiFeatureServices: (...args: unknown[]) => ({
      ...actual.createAiFeatureServices(...args),
      loadSavedVisitQuestions: async (id: string) =>
        mockSavedHomeQuestions(id, mockSaved.get(id) ?? []),
    }),
  };
});
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

export function futureOverviewVisit(id: string): Appointment {
  return { ...appointment, id, clinicLabel: id };
}

/** Only local query/model/storage results are synthetic; App navigation, retained session, consent and editor stay real. */
export async function renderOverviewGenerator(
  visits = [futureOverviewVisit('Home A')],
  consent = false,
  retainedModule = false,
) {
  mockSaved.clear();
  const store = createAppointmentStore(visits);
  const option = createAppleSelectionOption('available');
  const query = jest
    .spyOn(defaults, 'loadAppointment')
    .mockResolvedValue(visits[0] ?? null);
  const generate = jest
    .spyOn(defaults, 'generate')
    .mockImplementation(async input => {
      if (
        consent &&
        !(await input.confirmConsent({
          operationRunId: 'home-synthetic-run',
          providerId: option.provider.id,
          modelId: option.modelId,
          recipient: '합성 처리 대상',
          remoteProcessing: true,
          allowedScope: {
            sourceKinds: ['personal_record'],
            sourceIds: ['synthetic-record'],
          },
          payload: {
            messages: [
              {
                role: 'user',
                content: input.appointment.id + ' 합성 질문 준비',
              },
            ],
          },
          signal: input.signal,
        }))
      )
        return { status: 'consent_required', message: '동의가 필요해요.' };
      const result = readyQuestions();
      return {
        ...result,
        questions: result.questions.map(question => ({
          ...question,
          questionText: input.appointment.id + ': ' + question.questionText,
        })),
      };
    });
  const save = jest.spyOn(defaults, 'save').mockImplementation(async input => {
    mockSaved.set(
      input.appointment.id,
      input.questions.map(question => question.questionText),
    );
    return {
      questions: input.questions,
      caveats: input.caveats,
      memoryStatus: 'saved',
      validateSource: async () => true,
    };
  });
  const selectedAi = {
    selectionStore: {
      load: async () => ({
        providerId: option.provider.id,
        modelId: option.modelId,
      }),
      save: async () => {},
      clear: async () => {},
    },
    loadAppleOption: async () => option,
  };
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  await render(
    retainedModule ? (
      <AppointmentReminderProvider runtime={runtime}>
        <RetainedVisitModuleHarness
          dependencies={{ selectedAi }}
          renderModule={input => {
            if (input.navigationRouteKey && visits[0])
              runtime.overviewPreparationTargets.set(
                input.navigationRouteKey,
                visits[0].id,
              );
            return renderVisitQuestionsRoute({ ...input, readOnly: false });
          }}
        />
      </AppointmentReminderProvider>
    ) : (
      <App
        loadAppointments={async () => store.repository}
        loadRecordings={async () => []}
        aiFeatureServiceDependencies={{
          selectedAi,
        }}
      />
    ),
  );
  if (!retainedModule) {
    await fireEvent.press(screen.getByTestId('navigation-tab-overview'));
  }
  return { store, query, generate, save };
}

export async function enterOverviewGenerator(retainedModule = false) {
  await fireEvent.press(
    await screen.findByTestId(
      retainedModule ? 'retained-visit-module-open' : 'overview-prepare-visit',
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId('next-visit-generate')).toBeEnabled(),
  );
}

export async function generateHomeDraft() {
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  return screen.findByTestId('next-visit-question-text-0');
}
