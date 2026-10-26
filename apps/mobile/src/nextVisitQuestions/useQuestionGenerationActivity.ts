import { useCallback, useState } from 'react';
import type { AiWorkflowObserver } from '../agent/workflowActivity';
import {
  applyWorkflowStreamEvent,
  workflowProgressLabel,
} from '../agent/workflowActivity';

/** Keeps provisional text separate from validated questions and typed phase activity. */
export function useQuestionGenerationActivity() {
  const [activity, setActivity] = useState<string | null>(null);
  const [preview, setPreview] = useState('');

  const begin = useCallback((initialActivity: string) => {
    setActivity(initialActivity);
    setPreview('');
  }, []);
  // Finishing activity must not discard a response that was already displayed.
  const finish = useCallback(() => setActivity(null), []);
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
        setPreview(current => applyWorkflowStreamEvent(current, event));
      },
    }),
    [],
  );

  return { activity, preview, begin, clear, finish, createObserver };
}
