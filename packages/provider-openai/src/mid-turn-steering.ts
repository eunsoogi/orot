import type { LanguageModelExecutionOptions } from '@orot/model-runtime';
import type { ChatGPTPlanProviderOptions } from './provider';
import type { ChatGPTPlanNativeEvent } from './native-contract';

type Observer = NonNullable<LanguageModelExecutionOptions['midTurnSteering']>;

/** Eligibility permits an attempt; only a live response-created event exposes its control. */
export function supportsMidTurnSteering(options: ChatGPTPlanProviderOptions): boolean {
  return (
    options.model.supportsMidTurnSteering === true &&
    typeof options.bridge.startSteerableResponse === 'function' &&
    typeof options.bridge.steerResponse === 'function'
  );
}

/** One submission per socket. An ambiguous send/ack must never be retried automatically. */
export class MidTurnSteering {
  private closed = false;
  private ready = false;
  private submission:
    { id: string; status: 'submitted' | 'accepted' | 'pending' | 'applied' | 'failed' } | undefined;

  constructor(
    private readonly options: ChatGPTPlanProviderOptions,
    private readonly requestID: string,
    private readonly observer?: Observer,
  ) {}

  get enabled() {
    return Boolean(this.observer);
  }

  assertSupported() {
    if (this.enabled && !supportsMidTurnSteering(this.options))
      throw Object.assign(new Error('Mid-turn steering is unavailable for this transport.'), {
        kind: 'unsupported_capability',
      });
  }

  close() {
    this.closed = true;
  }

  async handle(event: ChatGPTPlanNativeEvent): Promise<boolean> {
    if (event.type !== 'steering_ready' && event.type !== 'steering') return false;
    if (!this.observer || this.closed) throw new Error('Unexpected steering event.');
    if (event.type === 'steering_ready') {
      if (!this.ready) {
        this.ready = true;
        this.observer.onReady({ submit: (id, text) => this.submit(id, text) });
      }
      return true;
    }
    const submission = this.submission;
    if (!submission || event.submissionId !== submission.id)
      throw new Error('Steering acknowledgement did not match the submission.');
    if (event.status === submission.status) return true;
    const allowed =
      submission.status === 'submitted'
        ? event.status === 'accepted' || event.status === 'failed'
        : (submission.status === 'accepted' || submission.status === 'pending') &&
          (event.status === 'pending' || event.status === 'applied' || event.status === 'failed');
    if (!allowed) throw new Error('Invalid steering acknowledgement order.');
    submission.status = event.status;
    // Await durable observer handling before exposing subsequent output or terminal completion.
    await this.observer.onEvent({ id: submission.id, status: event.status });
    return true;
  }

  permitsSnapshot(): boolean {
    return this.submission?.status === 'applied';
  }

  private async submit(id: string, text: string): Promise<void> {
    if (this.closed || !this.ready || this.submission || !id.trim() || !text.trim())
      throw new Error('Steering is no longer available for this response.');
    // Reserve before crossing the bridge, including synchronous failures and lost acknowledgements.
    this.submission = { id, status: 'submitted' };
    await this.options.bridge.steerResponse!(this.requestID, id, text);
  }
}
