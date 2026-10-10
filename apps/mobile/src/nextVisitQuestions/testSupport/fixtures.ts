import type { Appointment } from '@orot/domain';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionsScreenProps,
} from '../types';

export type Props = NextVisitQuestionsScreenProps<NextVisitEvidenceReference>;

// These fixed records keep screen tests synthetic and avoid reading personal health data.
export const appointment: Appointment = {
  id: 'synthetic-appointment-1',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: '합성 진료 예약',
};

export const source: NextVisitEvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-record-1',
  effectiveTime: '2035-05-20T09:00:00.000Z',
  reviewState: 'unreviewed',
  content: '합성 기록에서 가져온 예시 문장입니다.',
};

export const questions: readonly NextVisitQuestion[] = [
  {
    questionText: '최근 증상 변화를 어떻게 정리할까요?',
    rationale: '기록된 변화의 시점을 의료진과 확인합니다.',
    priority: 'routine',
    citations: [source],
  },
  {
    questionText: '복용 시간 변화를 어떻게 설명할까요?',
    rationale: '기록에 적힌 복용 시간의 의미를 확인합니다.',
    priority: 'routine',
    citations: [source],
  },
  {
    questionText: '추가로 확인할 기록이 있을까요?',
    rationale: '현재 근거에서 빠진 내용이 있는지 확인합니다.',
    priority: 'routine',
    citations: [source],
  },
];

export const theme: Props['theme'] = {
  colors: {
    canvas: '#ffffff',
    surface: '#ffffff',
    surfaceSubtle: '#f5f5f5',
    text: '#111111',
    textMuted: '#555555',
    border: '#cccccc',
    accent: '#234567',
    onAccent: '#ffffff',
    accentSubtle: '#e5edf5',
    accentText: '#234567',
    warning: '#704800',
    warningSurface: '#fff4d6',
    success: '#237a46',
    danger: '#8a1c1c',
    dangerSurface: '#fde8e8',
  },
  tokens: {
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
    radii: { control: 10, card: 16 },
    typography: {
      sizes: { caption: 13, body: 16, heading: 20, title: 26 },
      weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    },
    minTouchTarget: 44,
  },
};

export function makeProps(overrides: Partial<Props> = {}): Props {
  const onGenerate: Props['onGenerate'] = jest.fn(async () => ({
    status: 'ready' as const,
    questions,
    caveats: ['conflicting_records' as const],
  }));
  const onSaveReviewedQuestions: Props['onSaveReviewedQuestions'] = async (
    _appointment,
    reviewed,
    caveats,
  ) => ({ questions: reviewed, caveats, memoryStatus: 'saved' });

  return {
    theme,
    appointment: { status: 'ready', appointment },
    provider: {
      status: 'available',
      selection: { providerId: 'synthetic-provider', modelId: 'fixture-model' },
      displayName: '합성 제공자',
      privacyBoundary: 'on-device',
    },
    savedQuestions: {
      status: 'ready',
      appointmentId: appointment.id,
      questions: [],
      caveats: [],
    },
    onOpenProviderSelection: jest.fn(),
    onRefreshAppointment: jest.fn(),
    onRetrySavedQuestions: jest.fn(),
    onGenerate,
    onSaveReviewedQuestions,
    ...overrides,
  };
}
