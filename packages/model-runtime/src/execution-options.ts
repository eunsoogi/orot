/** Invocation-local steering; acceptance is not proof the successor applied the input. */
export interface LanguageModelExecutionOptions {
  readonly signal?: AbortSignal;
  /** Actual provider response processing observed, not dispatch, headers, or local readiness. */
  readonly onResponseStarted?: () => void;
  readonly midTurnSteering?: {
    onReady(control: { submit(id: string, text: string): Promise<void> }): void;
    onEvent(event: {
      readonly id: string;
      readonly status: 'accepted' | 'applied' | 'pending' | 'failed';
    }): Promise<void>;
  };
}
