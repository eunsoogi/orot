import { render } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { Appointment } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { AppointmentReminderProvider } from '../../appointmentReminders/AppointmentReminderContext';
import {
  appointment,
  candidate,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import { generateConversationVisitQuestions } from '../../aiFeatures/integration/conversationVisitQuestions';
import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';
import { loadVisitQuestionAppointment } from '../../aiFeatures/integration/visitQuestionAppointment';
import {
  defaultVisitQuestionRouteOperations as defaults,
  type VisitQuestionRouteOperations,
} from '../../aiFeatures/integration/visitQuestionsRouteOperations';
import { renderVisitQuestionsRoute } from '../OverviewVisitQuestionsRoute';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
let mockOperations: VisitQuestionRouteOperations | undefined;
jest.mock('../../aiFeatures/integration/NextVisitQuestionsRoute', () => ({
  NextVisitQuestionsRoute: ({
    operations,
  }: {
    operations?: VisitQuestionRouteOperations;
  }) => {
    mockOperations = operations;
    return null;
  },
}));

const now = '2035-06-06T00:00:00.000Z';
function visit(
  id: string,
  effectiveAt: string,
  title: string,
  status: Appointment['status'] = 'scheduled',
): Appointment {
  return {
    ...appointment,
    id,
    effectiveAt,
    status,
    calendarEventIdentifier: 'calendar-' + id,
    calendarEventSnapshot: {
      ...appointment.calendarEventSnapshot!,
      title,
      occurrenceDate: null,
    },
  };
}
const dental = visit('early-dental', '2035-06-06T11:00:00+09:00', '합성 치과');
const later = visit('later-test', '2035-06-05T23:00:00-04:00', '합성 검사');

async function fixture() {
  const lane = openSqliteTestDatabase(':memory:');
  await runMigrations(lane.database);
  const records = createRecordRepository(lane.database);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(lane.database);
  jest.mocked(openLocalStorage).mockResolvedValue(records);
  const add = async (...items: Appointment[]) => {
    for (const item of items) await records.put('appointment', item);
  };
  const manual = {
    ...visit('unverified', '2035-06-06T00:01:00Z', '합성 미확인'),
    calendarEventIdentifier: undefined,
    calendarEventSnapshot: undefined,
  };
  await add(
    later,
    dental,
    manual,
    visit('cancelled', '2035-06-06T00:13:00Z', '합성 취소', 'cancelled'),
    visit('past', '2035-06-05T23:13:00Z', '합성 지난 일정'),
    visit('done', '2035-06-06T00:20:00Z', '합성 완료', 'completed'),
    visit('same-time', '2035-06-06T02:00:00.000Z', '합성 동일 시각'),
  );
  return { ...lane, add };
}

test.each([
  [undefined, dental.id, '다음 진료 질문을 만들어줘'],
  [undefined, dental.id, '진료 질문 준비하기'],
  [later.id, later.id, '선택한 검사 질문을 준비해줘'],
] as const)(
  'uses the authorized local target for visit generation: %s %s',
  async (appointmentId, expected, request) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
    const lane = await fixture();
    try {
      const generate = jest.fn(async () => ({
        status: 'ready' as const,
        questions: [candidate],
        caveats: [],
        validateSource: async () => true,
      }));
      const selection = await generateConversationVisitQuestions({
        ownerKey: 'synthetic-visit',
        appointmentId,
        request,
        operations: { ...defaults, generate },
        loadSaved: async id => ({
          status: 'ready',
          appointmentId: id,
          questions: [],
          caveats: [],
          restorationNotice: '',
        }),
        resolveSelectedAi: async () =>
          ({ status: 'ready' }) as SelectedAiResolution,
        confirmConsent: async () => true,
        observer: { suppressContextualOpening: true },
        isCurrentOwner: () => true,
        signal: new AbortController().signal,
      });
      expect(selection).toMatchObject({
        status: 'ready',
        appointment: { id: expected },
      });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          appointment: expect.objectContaining({ id: expected }),
        }),
      );
    } finally {
      lane.close();
      jest.useRealTimers();
    }
  },
);

test('the Overview preparation route saves to its selected visit even if a new earlier visit is present', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
  const lane = await fixture();
  const result = {
    questions: [],
    caveats: [],
    memoryStatus: 'saved' as const,
    validateSource: async () => true,
  };
  const save = jest.spyOn(defaults, 'save').mockResolvedValue(result);
  const runtime = {
    overviewPreparationTargets: new Map([['visit-route', dental.id]]),
  };
  const view = await render(
    <AppointmentReminderProvider runtime={runtime as never}>
      {renderVisitQuestionsRoute({
        navigationRouteKey: 'visit-route',
      } as never)}
    </AppointmentReminderProvider>,
  );
  try {
    const loaded = await mockOperations!.loadAppointment(now);
    expect(loaded?.id).toBe(dental.id);
    const newlyImported = visit(
      'new-earlier',
      '2035-06-06T01:00:00Z',
      '합성 새 진료',
    );
    await lane.add(newlyImported);
    expect((await loadVisitQuestionAppointment(now))?.id).toBe(
      newlyImported.id,
    );
    expect((await mockOperations!.loadAppointment(now))?.id).toBe(dental.id);
    const input = { appointment: loaded } as Parameters<
      typeof defaults.save
    >[0];
    await expect(mockOperations!.save(input)).resolves.toBe(result);
    expect(save).toHaveBeenCalledWith(input);
    await lane.add({
      ...dental,
      status: 'rescheduled',
      effectiveAt: '2035-06-06T16:00:00+09:00',
    });
    await expect(mockOperations!.save(input)).rejects.toThrow('target changed');
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
    save.mockRestore();
    lane.close();
    jest.useRealTimers();
  }
});
