import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment } from '@orot/domain';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type {
  AppointmentViewState,
  ProviderViewState,
  SavedQuestionsState,
  SaveReviewedQuestionsResult,
  EvidenceCaveat,
  NextVisitQuestion,
} from '../../nextVisitQuestions';
import { nextVisitQuestionsCopy as copy } from '../../nextVisitQuestions/copy';
import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';
import { defaultVisitQuestionRouteOperations } from './visitQuestionsRouteOperations';
import {
  sameVisitQuestionSelection,
  visitQuestionsProviderState,
} from './nextVisitQuestionsRoutePresentation';
import { useVisitQuestionSourceOpener } from './useVisitQuestionSourceOpener';

/** Owns the async appointment, provider, citation and save state behind the screen. */
export function useNextVisitQuestionsRoute(
  props: NextVisitQuestionsRouteProps,
) {
  const {
    confirmConsent,
    loadSavedVisitQuestions,
    onOpenProviderSelection,
    resolveSelectedAi,
    resolveSource,
    selectedAiRevision,
  } = props;
  const { onOpenSource, rememberValidator } =
    useVisitQuestionSourceOpener(props);
  const operationsOverride = props.operations;
  const operations = useMemo(
    () => ({ ...defaultVisitQuestionRouteOperations, ...operationsOverride }),
    [operationsOverride],
  );
  const [appointment, setAppointment] = useState<AppointmentViewState>({
    status: 'loading',
  });
  const [provider, setProvider] = useState<ProviderViewState>({
    status: 'loading',
    selection: null,
  });
  const [savedQuestions, setSavedQuestions] = useState<
    SavedQuestionsState<VisitQuestionEvidenceItem>
  >({
    status: 'loading',
    questions: [],
  });
  const [providerRetry, setProviderRetry] = useState(0);
  const [savedRetry, setSavedRetry] = useState(0);
  const [saveNotice, setSaveNotice] = useState('');
  const appointmentRequest = useRef(0);
  const refreshAppointment = useCallback(async () => {
    const request = ++appointmentRequest.current;
    setAppointment({ status: 'loading' });
    setSaveNotice('');
    try {
      const current = await operations.loadAppointment(
        new Date().toISOString(),
      );
      // Ignore an older lookup after the user retries the current appointment.
      if (appointmentRequest.current !== request) return;
      setAppointment(
        current
          ? { status: 'ready', appointment: current }
          : { status: 'empty' },
      );
    } catch {
      if (appointmentRequest.current === request)
        setAppointment({ status: 'error', message: copy.appointment.error });
    }
  }, [operations]);

  const refreshProvider = useCallback(async () => {
    setProvider({ status: 'loading', selection: null });
    try {
      setProvider(visitQuestionsProviderState(await resolveSelectedAi()));
    } catch {
      setProvider({
        status: 'error',
        selection: null,
        message: copy.provider.error,
      });
    }
  }, [resolveSelectedAi]);

  useEffect(() => {
    refreshAppointment().catch(() => undefined);
  }, [refreshAppointment]);
  useEffect(() => {
    refreshProvider().catch(() => undefined);
  }, [providerRetry, selectedAiRevision, refreshProvider]);

  const appointmentId =
    appointment.status === 'ready' ? appointment.appointment.id : null;
  useEffect(() => {
    let active = true;
    if (!appointmentId) {
      setSavedQuestions({ status: 'loading', questions: [] });
      return () => {
        active = false;
      };
    }
    setSavedQuestions({ status: 'loading', questions: [] });
    loadSavedVisitQuestions(appointmentId)
      .then(result => {
        if (active) setSavedQuestions(result);
      })
      .catch(() => {
        if (active)
          setSavedQuestions({
            status: 'error',
            appointmentId,
            questions: [],
            message: copy.saved.error,
          });
      });
    return () => {
      active = false;
    };
  }, [appointmentId, loadSavedVisitQuestions, savedRetry]);

  const onGenerate = useCallback(
    async (
      currentAppointment: Appointment,
      selection: { providerId: string; modelId: string },
      signal: AbortSignal,
    ) => {
      try {
        // Re-resolve before inference; a stale screen selection cannot authorize a changed provider.
        const resolved = await resolveSelectedAi();
        setProvider(visitQuestionsProviderState(resolved));
        if (resolved.status !== 'ready') {
          return {
            status: 'provider_unavailable' as const,
            message:
              resolved.status === 'selection-required'
                ? copy.provider.unselected
                : copy.generation.providerUnavailable,
          };
        }
        if (!sameVisitQuestionSelection(selection, resolved.selection)) {
          return {
            status: 'provider_unavailable' as const,
            message: copy.generation.providerChanged,
          };
        }
        const result = await operations.generate({
          appointment: currentAppointment,
          selectedAi: resolved,
          confirmConsent,
          signal,
        });
        if (result.status === 'ready') {
          rememberValidator(result.validateSource);
          return {
            status: 'ready' as const,
            questions: result.questions,
            caveats: result.caveats,
          };
        }
        if (result.status === 'refresh_required')
          refreshAppointment().catch(() => undefined);
        return result;
      } catch {
        return {
          status: 'unavailable' as const,
          message: copy.generation.genericError,
        };
      }
    },
    [
      operations,
      confirmConsent,
      rememberValidator,
      resolveSelectedAi,
      refreshAppointment,
    ],
  );

  const onSaveReviewedQuestions = useCallback(
    async (
      currentAppointment: Appointment,
      questions: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[],
      caveats: readonly EvidenceCaveat[],
    ): Promise<SaveReviewedQuestionsResult<VisitQuestionEvidenceItem>> => {
      setSaveNotice('');
      try {
        const result = await operations.save({
          appointment: currentAppointment,
          questions,
          caveats,
          resolveSource,
        });
        rememberValidator(result.validateSource);
        return {
          questions: result.questions,
          caveats: result.caveats,
          memoryStatus: result.memoryStatus,
        };
      } catch (error) {
        // Leave the draft visible when its appointment or source citation fails save-time validation.
        setSaveNotice(
          '예약이나 원문 근거가 바뀌어 저장하지 못했어요. 최신 내용을 확인해 주세요.',
        );
        throw error;
      }
    },
    [operations, rememberValidator, resolveSource],
  );

  const openProviderSelection = useCallback(() => {
    if (provider.status === 'error') setProviderRetry(value => value + 1);
    else onOpenProviderSelection();
  }, [provider.status, onOpenProviderSelection]);

  return {
    appointment,
    onGenerate,
    onOpenSource,
    onRetrySavedQuestions: () => setSavedRetry(value => value + 1),
    onSaveReviewedQuestions,
    openProviderSelection,
    refreshAppointment,
    saveNotice,
    provider,
    savedQuestions,
  };
}
