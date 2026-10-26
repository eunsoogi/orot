import { runStandardAdaptersAppleProbe } from './standardAdaptersAppleProbe';
import { runStandardAdaptersOpenAIProbe } from './standardAdaptersOpenAIProbe';
import { runPrivacySafeCallbacksProbe } from './privacySafeCallbacksProbe';

/** Each provider keeps its own native test port and cleanup receipt. No live account or model inference. */
export async function runStandardAdaptersProbe() {
  const apple = await runStandardAdaptersAppleProbe();
  const openai = await runStandardAdaptersOpenAIProbe();
  const privacySafeCallbacks = await runPrivacySafeCallbacksProbe();
  return {
    apple,
    openai,
    privacySafeCallbacks,
    synthetic: true,
    modelExecution: 'mock',
    actualModel: 'not-run',
    realAccount: 'unverified',
  };
}
