import {
  providerFailure,
  providerSuccess,
  type ProviderByKind,
  type ProviderError,
  type ProviderInputType,
  type ProviderKind,
  type ProviderResult,
  type RegisteredProvider,
} from './contracts';

export interface ProviderRegistry {
  register(provider: RegisteredProvider): ProviderResult<void>;
  get<K extends ProviderKind>(kind: K, id: string): ProviderByKind[K] | undefined;
  list<K extends ProviderKind>(kind: K): readonly ProviderByKind[K][];
}

const inputTypes = new Set<ProviderInputType>(['audio', 'image', 'text']);

function invalidProvider(message: string): ProviderError {
  return { code: 'invalid_provider', message, retryable: false };
}

function validInputTypes(values: readonly ProviderInputType[]): boolean {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => inputTypes.has(value)) &&
    new Set(values).size === values.length
  );
}

function validateProvider(provider: RegisteredProvider): ProviderError | undefined {
  if (
    !provider ||
    typeof provider.id !== 'string' ||
    !provider.id.trim() ||
    typeof provider.displayName !== 'string' ||
    !provider.displayName.trim() ||
    !provider.capabilities ||
    !validInputTypes(provider.capabilities.inputTypes)
  ) {
    return invalidProvider('Provider identity and supported input types are required.');
  }

  if (provider.kind === 'language-model') {
    const { capabilities } = provider;
    if (
      typeof capabilities.streaming !== 'boolean' ||
      typeof capabilities.toolCalling !== 'boolean' ||
      typeof capabilities.structuredOutput !== 'boolean' ||
      (capabilities.streaming && typeof provider.stream !== 'function')
    ) {
      return invalidProvider('Language model capabilities must match the provider methods.');
    }
  }

  if (provider.kind === 'transcription') {
    if (
      typeof provider.capabilities.streaming !== 'boolean' ||
      (provider.capabilities.streaming && typeof provider.stream !== 'function')
    ) {
      return invalidProvider('Transcription capabilities must match the provider methods.');
    }
  }

  if (!['language-model', 'transcription', 'embedding'].includes(provider.kind)) {
    return invalidProvider('Provider kind is not supported.');
  }

  return undefined;
}

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<ProviderKind, Map<string, RegisteredProvider>>();

  register(provider: RegisteredProvider): ProviderResult<void> {
    const validationError = validateProvider(provider);
    if (validationError) return providerFailure(validationError);

    const kindProviders = this.providers.get(provider.kind) ?? new Map();
    if (kindProviders.has(provider.id)) {
      return providerFailure({
        code: 'duplicate_provider',
        message: 'A provider with this id is already registered for the kind.',
        retryable: false,
      });
    }

    kindProviders.set(provider.id, provider);
    this.providers.set(provider.kind, kindProviders);
    return providerSuccess(undefined);
  }

  get<K extends ProviderKind>(kind: K, id: string): ProviderByKind[K] | undefined {
    return this.providers.get(kind)?.get(id) as ProviderByKind[K] | undefined;
  }

  list<K extends ProviderKind>(kind: K): readonly ProviderByKind[K][] {
    return [...(this.providers.get(kind)?.values() ?? [])] as ProviderByKind[K][];
  }
}
