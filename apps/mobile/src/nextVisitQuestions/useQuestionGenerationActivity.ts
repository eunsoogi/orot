import { useCallback, useState } from 'react';
import type { AiWorkflowObserver } from '../agent/workflowActivity';
import {
  applyWorkflowStreamEvent,
  workflowProgressLabel,
} from '../agent/workflowActivity';
import { t } from '../i18n';

/** Keeps provisional question text separate from validated questions and route results. */
export function useQuestionGenerationActivity() {
  const [activity, setActivity] = useState<string | null>(null);
  const [preview, setPreview] = useState('');

  const begin = useCallback((initialActivity: string) => {
    setActivity(initialActivity);
    setPreview('');
  }, []);
  const clear = useCallback(() => {
    setActivity(null);
    setPreview('');
  }, []);
  const createObserver = useCallback(
    (isCurrentRun: () => boolean): AiWorkflowObserver => ({
      onProgress: event => {
        if (isCurrentRun()) setActivity(workflowProgressLabel(event));
      },
      onTaskStreamEvent: event => {
        if (!isCurrentRun()) return;
        if (event.type === 'started')
          setActivity(t('aiActivity.phase.response'));
        setPreview(current => applyWorkflowStreamEvent(current, event));
      },
    }),
    [],
  );

  return { activity, preview, begin, clear, createObserver };
}
