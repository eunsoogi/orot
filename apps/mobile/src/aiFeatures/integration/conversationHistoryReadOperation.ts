import type { CommittedReportScope } from '../../healthEvidence/healthContext/committedReportScope';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { createConversationArtifactDiscovery } from './conversationArtifactDiscovery';

type Discovery = ReturnType<typeof createConversationArtifactDiscovery>;
type Methods = Pick<Discovery, 'readSession' | 'revalidateSession'>;
type Storage = ReturnType<typeof createConversationArtifactStorage>;
type Operation = Methods & {
  readonly healthContextReportScope?: CommittedReportScope;
  readonly storage?: Storage;
  readonly readToolTurnsSnapshot?: Storage['readToolTurnsSnapshot'];
  dispose(): void;
};
type HistoryContext = {
  readonly healthContextReportScope?: CommittedReportScope;
  storage(value: Storage): Storage;
};
const owners = new WeakMap<
  Discovery,
  {
    methods: Methods;
    version: Discovery['activeSessionVersion'];
    begin(signal: AbortSignal, historyPage: boolean): Operation | undefined;
  }
>();

/** Only the actual discovery factory installs its original storage capability. */
export function registerConversationHistoryReadOwner(
  discovery: Discovery,
  begin: (signal: AbortSignal, historyPage: boolean) => Operation | undefined,
) {
  owners.set(discovery, {
    methods: {
      readSession: discovery.readSession,
      revalidateSession: discovery.revalidateSession,
    },
    version: discovery.activeSessionVersion,
    begin,
  });
}

/** Keep all three fences and every hydration callback. Share report values only
 * until this history call ends; changed/custom owners keep their strict paths. */
export async function withConversationHistoryReadOperation<T>(
  discovery: Discovery,
  signal: AbortSignal,
  work: (scoped: Discovery, context?: HistoryContext) => Promise<T>,
  historyPage = false,
) {
  const owner = owners.get(discovery);
  const owned = () =>
    owner &&
    discovery.readSession === owner.methods.readSession &&
    discovery.revalidateSession === owner.methods.revalidateSession &&
    discovery.activeSessionVersion === owner.version;
  if (!owned()) return work(discovery);
  const operation = owner!.begin(signal, historyPage);
  if (!operation) return work(discovery);
  let active = true;
  const scoped = new Proxy(discovery, {
    get(target, key, receiver) {
      if (key === 'readSession')
        return (...args: Parameters<Discovery['readSession']>) =>
          (active && owned() ? operation.readSession : target.readSession)(
            ...args,
          );
      if (key === 'revalidateSession')
        return (...args: Parameters<Discovery['revalidateSession']>) =>
          (active && owned()
            ? operation.revalidateSession
            : target.revalidateSession)(...args);
      return Reflect.get(target, key, receiver);
    },
  });
  // Only the factory's exact storage can borrow its report calculation scope.
  // The original snapshot callback remains the fallback after replacement/disposal;
  // live tool source reads are never wrapped or granted history validity authority.
  const originalSnapshot = operation.storage?.readToolTurnsSnapshot;
  const context: HistoryContext = {
    get healthContextReportScope() {
      return active && owned() ? operation.healthContextReportScope : undefined;
    },
    storage(value) {
      if (value !== operation.storage || !operation.readToolTurnsSnapshot)
        return value;
      return new Proxy(value, {
        get(target, key, receiver) {
          if (key === 'readToolTurnsSnapshot')
            return (...args: Parameters<Storage['readToolTurnsSnapshot']>) =>
              (active &&
                owned() &&
                target.readToolTurnsSnapshot === originalSnapshot
                ? operation.readToolTurnsSnapshot!
                : target.readToolTurnsSnapshot)(...args);
          return Reflect.get(target, key, receiver);
        },
      });
    },
  };
  try {
    return await work(scoped, context);
  } finally {
    active = false;
    operation.dispose();
  }
}
