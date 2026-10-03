import type {
  LanguageModelInputPart,
  LanguageModelRequest,
} from '@orot/model-runtime';
import { compileResponseSchema, type AppleNativeRequest } from './schema';

const safetyInstructions = [
  'Help prepare questions the patient can ask at a medical visit.',
  'Use only supplied evidence and answer in Korean.',
  "The patient is the speaker and their clinician is the listener. Address the clinician as '선생님' and ask what to discuss or check about the supplied change. Do not ask the patient how they feel.",
  'Write every string in structured output in Korean. Return one concise, polite question ending with a question mark.',
  'Do not diagnose or give medical or medication-change recommendations.',
  'Preserve supplied source IDs exactly in structured output.',
].join(' ');

export function serializeAppleRequest(request: LanguageModelRequest): AppleNativeRequest {
  const instructions = [safetyInstructions];
  const conversation: string[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') {
      conversation.push(
        'Tool result ' + message.toolCallId + ': ' + JSON.stringify(message.result),
      );
      continue;
    }
    const content = textContent(message.content);
    if (message.role === 'system') {
      instructions.push(content);
      continue;
    }
    conversation.push(message.role + ': ' + content);
    if (message.role === 'assistant' && message.toolCalls?.length) {
      conversation.push('Requested tools: ' + JSON.stringify(message.toolCalls));
    }
  }
  if (!conversation.length) {
    throw codedError('INVALID_REQUEST', 'At least one non-system message is required.');
  }
  const tools = request.tools ?? [];
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool.name || names.has(tool.name)) {
      throw codedError('INVALID_REQUEST', 'Tool names must be present and unique.');
    }
    names.add(tool.name);
  }
  if (tools.length) {
    instructions.push([
      'Available tools:',
      ...tools.map(tool => tool.name + ': ' + (tool.description?.trim() || 'No description provided.')),
    ].join('\n'));
  }
  const format = request.responseFormat;
  const mode = tools.length
    ? format ? 'mixed' : 'tools'
    : format ? 'structured' : 'text';
  return {
    instructions: instructions.join('\n\n'),
    prompt: conversation.join('\n'),
    mode,
    schema: compileResponseSchema(tools, format?.schema, format?.name),
    toolNames: tools.map((tool) => tool.name),
    maxOutputTokens: request.maxOutputTokens,
    temperature: request.temperature,
  };
}

function textContent(
  content: string | readonly LanguageModelInputPart[],
): string {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type !== 'text') {
      throw codedError('UNSUPPORTED_INPUT', 'Apple Foundation Models accepts text input only.');
    }
    return part.text;
  }).join('\n');
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
