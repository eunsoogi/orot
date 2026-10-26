import { runStandardAdaptersAppleProbe } from './standardAdaptersAppleProbe';
import { runStandardAdaptersOpenAIProbe } from './standardAdaptersOpenAIProbe';

/** Each provider keeps its own native test port and cleanup receipt. No live account or model inference. */
export async function runStandardAdaptersProbe() {
  const apple = await runStandardAdaptersAppleProbe();
  const openai = await runStandardAdaptersOpenAIProbe();
  return {
    apple,
    openai,
    synthetic: true,
    modelExecution: 'mock',
    actualModel: 'not-run',
    realAccount: 'unverified',
  };
}
