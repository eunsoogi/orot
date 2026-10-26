import type { BindToolsInput, ToolChoice } from '@langchain/core/language_models/chat_models';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import {
  type JsonObject,
  type JsonValue,
  type LanguageModelProvider,
  type LanguageModelRequest,
  type ProviderErrorCode,
  type ToolDefinition,
} from '@orot/model-runtime';
import {
  NativeChatModel,
  NativeChatModelError,
  type NativeChatModelCallOptions,
} from './chatModel';

type NativeToolChoice = 'auto' | 'none' | 'required';

function fail(
  code: Extract<ProviderErrorCode, 'invalid_request' | 'unsupported_capability'>,
): never {
  throw new NativeChatModelError({ code, message: '', retryable: false });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function copyJsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) fail('invalid_request');
  if (Object.getOwnPropertySymbols(value).length) fail('invalid_request');
  ancestors.add(value);
  const copied = Array.isArray(value)
    ? Array.from(value, (item) => copyJsonValue(item, ancestors))
    : isPlainObject(value)
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, copyJsonValue(item, ancestors)]),
        )
      : fail('invalid_request');
  ancestors.delete(value);
  return copied;
}

function copyJsonObject(value: unknown): JsonObject {
  const copied = copyJsonValue(value);
  if (!copied || typeof copied !== 'object' || Array.isArray(copied)) fail('invalid_request');
  return copied as JsonObject;
}

/** Convert LangChain function schemas to provider-neutral definitions without invoking tool code. */
function normalizeTool(tool: BindToolsInput): ToolDefinition {
  let converted: ReturnType<typeof convertToOpenAITool>;
  try {
    // BindToolsInput also includes StructuredToolParams, which the converter accepts at runtime.
    converted = convertToOpenAITool(tool as Parameters<typeof convertToOpenAITool>[0]);
  } catch {
    return fail('invalid_request');
  }

  const candidate = converted as unknown as Record<string, unknown>;
  if (candidate.type !== 'function' || !isPlainObject(candidate.function))
    return fail('unsupported_capability');
  const fn = candidate.function;
  if (fn.strict === true) return fail('unsupported_capability');
  if (fn.strict !== undefined && typeof fn.strict !== 'boolean') fail('invalid_request');
  if (typeof fn.name !== 'string' || !fn.name.trim()) fail('invalid_request');
  if (fn.description !== undefined && typeof fn.description !== 'string') fail('invalid_request');

  return {
    name: fn.name,
    ...(fn.description === undefined ? {} : { description: fn.description }),
    inputSchema: copyJsonObject(fn.parameters),
  };
}

function normalizeTools(tools: BindToolsInput[]): readonly ToolDefinition[] {
  const definitions = tools.map(normalizeTool);
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name)) fail('invalid_request');
    names.add(definition.name);
  }
  return definitions;
}

function normalizeToolChoice(choice: ToolChoice | undefined): NativeToolChoice {
  if (choice === undefined || choice === 'auto') return 'auto';
  if (choice === 'none') return 'none';
  if (choice === 'any' || choice === 'required') return 'required';
  return fail('unsupported_capability');
}

function withToolRequest(
  provider: LanguageModelProvider,
  tools: readonly ToolDefinition[],
  choice: NativeToolChoice,
): LanguageModelProvider {
  function withTools(request: LanguageModelRequest): LanguageModelRequest {
    if (request.tools !== undefined || request.toolChoice !== undefined) fail('invalid_request');
    return {
      ...request,
      ...(choice === 'none' || tools.length === 0 ? {} : { tools }),
      ...(choice === 'required' ? { toolChoice: 'required' as const } : {}),
    };
  }
  return {
    id: provider.id,
    kind: provider.kind,
    displayName: provider.displayName,
    // Share the selected provider's declared capabilities; binding must never enable them.
    capabilities: provider.capabilities,
    ...(provider.searchPublicWeb ? { searchPublicWeb: provider.searchPublicWeb } : {}),
    ...(provider.stream
      ? { stream: (request, options) => provider.stream!(withTools(request), options) }
      : {}),
    generate: (request, options) => provider.generate(withTools(request), options),
  };
}

/** A separate strategy subclass keeps tool policy out of the shared native invocation adapter. */
export class NativeToolBindingChatModel extends NativeChatModel {
  private boundTools: readonly ToolDefinition[] = [];
  private boundToolChoice: NativeToolChoice = 'auto';
  private boundOptions: Partial<NativeChatModelCallOptions> = {};

  constructor(provider: LanguageModelProvider) {
    super(provider);
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<NativeChatModelCallOptions>,
  ): NativeToolBindingChatModel {
    const definitions = normalizeTools(tools);
    if (definitions.length > 0 && !this.provider.capabilities.toolCalling)
      fail('unsupported_capability');
    const choice = normalizeToolChoice(kwargs?.tool_choice);
    if (choice === 'required' && definitions.length === 0) fail('invalid_request');

    const callOptions = { ...(kwargs ?? {}) };
    delete callOptions.tool_choice;
    // A fresh instance keeps callers from bypassing schema and provider-capability validation.
    const bound = this.cloneWithProvider(this.provider);
    bound.boundTools = definitions;
    bound.boundToolChoice = choice;
    // Keep the public structured-output method available even when tools bind model controls.
    bound.boundOptions = callOptions;
    return bound;
  }

  /** Derived strategies must survive binding, including their public stream privacy boundary. */
  protected cloneWithProvider(provider: LanguageModelProvider): NativeToolBindingChatModel {
    return new NativeToolBindingChatModel(provider);
  }

  /** LangChain may insert undefined defaults; only explicit invocation values replace bound ones. */
  protected override resolveInvocationOptions(options: this['ParsedCallOptions']) {
    return {
      ...this.boundOptions,
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    } as this['ParsedCallOptions'];
  }

  protected override prepareInvocation(options: this['ParsedCallOptions']) {
    const choice =
      options.tool_choice === undefined
        ? this.boundToolChoice
        : normalizeToolChoice(options.tool_choice);
    const tools = choice === 'none' ? [] : this.boundTools;
    if (tools.length > 0 && !this.provider.capabilities.toolCalling) fail('unsupported_capability');
    if (choice === 'required' && tools.length === 0) fail('invalid_request');

    const callOptions = { ...options };
    delete callOptions.tool_choice;
    // Reuse the base request, cancellation, error, usage, and privacy behavior for one dispatch.
    return { provider: withToolRequest(this.provider, tools, choice), options: callOptions };
  }
}
