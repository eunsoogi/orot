import { useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { createNextVisitQuestionsTheme } from '../src/aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import { NextVisitProbeShell } from './nextVisitProbeShell';
import type { Appointment } from '@orot/domain';
import {
  NextVisitQuestionsScreen,
  type EvidenceCaveat,
  type NextVisitEvidenceReference,
  type NextVisitQuestion,
  type NextVisitQuestionsScreenProps,
} from '../src/nextVisitQuestions';

type Props = NextVisitQuestionsScreenProps<NextVisitEvidenceReference>;

const appointment: Appointment = {
  id: 'synthetic-next-visit-1',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: '합성 진료 예약',
};

const source: NextVisitEvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-next-visit-record-1',
  effectiveTime: '2035-05-20T09:00:00.000Z',
  reviewState: 'unreviewed',
  content: '합성 기록에서 가져온 예시 문장입니다.',
};

const candidates: readonly NextVisitQuestion[] = [
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

/** Uses deterministic in-memory adapters; it never contacts a provider or reads real records. */
export function NextVisitQuestionsProbe() {
  const theme = createNextVisitQuestionsTheme(useColorScheme() === 'dark');
  const [savedQuestions, setSavedQuestions] = useState<
    readonly NextVisitQuestion[]
  >([]);
  const [savedCaveats, setSavedCaveats] = useState<readonly EvidenceCaveat[]>(
    [],
  );
  const [adapterStatus, setAdapterStatus] = useState('synthetic-ready');
  const [screenRevision, setScreenRevision] = useState(0);
  const generationResolver = useRef<(() => void) | null>(null);

  const onGenerate: Props['onGenerate'] = async (
    _appointment,
    _selection,
    signal,
  ) => {
    setAdapterStatus('synthetic-generating');
    // Keep loading observable until Detox explicitly releases this synthetic request.
    await new Promise<void>(resolve => {
      const finish = () => {
        signal.removeEventListener('abort', finish);
        if (generationResolver.current === finish) {
          generationResolver.current = null;
        }
        resolve();
      };
      generationResolver.current = finish;
      signal.addEventListener('abort', finish, { once: true });
    });
    if (signal.aborted) {
      setAdapterStatus('synthetic-cancelled');
      return { status: 'cancelled' };
    }
    setAdapterStatus('synthetic-review');
    return {
      status: 'ready',
      questions: candidates,
      caveats: ['incomplete_coverage', 'conflicting_records'],
    };
  };

  const onSaveReviewedQuestions: Props['onSaveReviewedQuestions'] = async (
    _appointment,
    reviewed,
    caveats,
  ) => {
    setSavedQuestions([...reviewed]);
    setSavedCaveats([...caveats]);
    setAdapterStatus('synthetic-saved-in-memory');
    return { questions: reviewed, caveats, memoryStatus: 'saved' };
  };

  return (
    <NextVisitProbeShell
      adapterStatus={adapterStatus}
      canReload={savedQuestions.length > 0}
      onComplete={() => generationResolver.current?.()}
      onReload={() => setScreenRevision(revision => revision + 1)}
    >
      {onRouteStateChange => (
        <NextVisitQuestionsScreen
          // Preserve only the synthetic adapter state while rechecking screen rehydration.
          key={screenRevision}
          appointment={{ status: 'ready', appointment }}
          provider={{
            status: 'available',
            selection: {
              providerId: 'synthetic-provider',
              modelId: 'fixture-model',
            },
            displayName: '합성 제공자',
            privacyBoundary: 'on-device',
          }}
          savedQuestions={{
            status: 'ready',
            appointmentId: appointment.id,
            questions: savedQuestions,
            caveats: savedCaveats,
          }}
          onOpenProviderSelection={() =>
            setAdapterStatus('synthetic-selection')
          }
          onRefreshAppointment={() =>
            setAdapterStatus('synthetic-calendar-refresh')
          }
          onRetrySavedQuestions={() => setAdapterStatus('synthetic-reload')}
          onGenerate={onGenerate}
          onSaveReviewedQuestions={onSaveReviewedQuestions}
          theme={theme}
          onRouteStateChange={onRouteStateChange}
        />
      )}
    </NextVisitProbeShell>
  );
}
