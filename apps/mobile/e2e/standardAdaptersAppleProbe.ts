import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import {
  createProductionChatModel,
  invokeProductionRequest,
} from '@orot/agent-runtime';
import {
  appleFoundationModelsProbeBridge,
  withMockAppleModel,
} from './appleModelMockBridge';

const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

/** Exercise standard dispatch and schema parsing through shipping serialization and RN modules.
 * Only raw SDK replies are synthetic; the native mock receipts must observe every request. */
export async function runStandardAdaptersAppleProbe() {
  let callbackEvents = 0;
  const callback = () => {
    callbackEvents += 1;
  };
  const result = await withMockAppleModel(
    [
      request => {
        if (request.responseFormat)
          throw new Error('Plain invocation gained a schema');
        return { text: 'one request' };
      },
      request => {
        if (request.responseFormat?.name !== 'adapter_answer')
          throw new Error('Native schema format missing');
        return { text: '{"answer":"valid"}' };
      },
      request => {
        if (request.responseFormat?.name !== 'adapter_answer')
          throw new Error('Invalid schema case lost format');
        return { text: '{"answer":42}' };
      },
      () => ({ snapshots: ['draft', 'revised final'] }),
    ],
    async () => {
      const provider = new AppleFoundationModelsProvider(
        appleFoundationModelsProbeBridge,
      );
      const plain = await invokeProductionRequest(provider, {
        messages: [{ role: 'user', content: 'Synthetic invoke' }],
      });
      if (plain.text !== 'one request' || plain.usage !== undefined)
        throw new Error('Native invoke or absent usage changed');
      const model = createProductionChatModel(provider);
      const structured = model.withStructuredOutput(schema, {
        name: 'adapter_answer',
      });
      const parsed = await structured.invoke('Synthetic schema', {
        callbacks: [{ handleLLMEnd: callback, handleChainStart: callback }],
      });
      if (parsed.answer !== 'valid')
        throw new Error('Native structured value was lost');
      let invalidRejected = false;
      try {
        await structured.invoke('Synthetic invalid schema');
      } catch {
        invalidRejected = true;
      }
      if (!invalidRejected)
        throw new Error('Invalid native schema value was accepted');
      const chunks = [];
      for await (const part of await model.stream(
        'Synthetic replacement stream',
        { callbacks: [{ handleLLMNewToken: callback }] },
      ))
        chunks.push(part.content);
      if (chunks.length !== 1 || chunks[0] !== 'revised final')
        throw new Error('Replacement snapshots escaped the buffer');
      if (callbackEvents !== 0)
        throw new Error('Private adapter data reached a callback');
      return {
        invoke: plain.text,
        schema: 'validated',
        invalidRejected,
        bufferedFinal: chunks[0],
        usageAbsent: true,
        callbackEvents,
      };
    },
  );
  if (result.mockObservation.requests.length !== 4)
    throw new Error('Native dispatch receipt count changed');
  return result;
}
