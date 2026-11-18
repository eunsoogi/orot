import type { createConversationArtifactDiscovery } from './conversationArtifactDiscovery';

type Discovery = ReturnType<typeof createConversationArtifactDiscovery>;
type Methods = Pick<Discovery, 'readSession' | 'revalidateSession'>;
type Operation = Methods & { dispose(): void };
const owners = new WeakMap<
  Discovery,
  {
    methods: Methods;
    version: Discovery['activeSessionVersion'];
    begin(signal: AbortSignal): Operation | undefined;
  }
>();

/** Only the actual discovery factory installs its original storage capability. */
export function registerConversationHistoryReadOwner(
  discovery: Discovery,
  begin: (signal: AbortSignal) => Operation | undefined,
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
  work: (scoped: Discovery) => Promise<T>,
) {
  const owner = owners.get(discovery);
  const owned = () =>
    owner &&
    discovery.readSession === owner.methods.readSession &&
    discovery.revalidateSession === owner.methods.revalidateSession &&
    discovery.activeSessionVersion === owner.version;
  if (!owned()) return work(discovery);
  const operation = owner!.begin(signal);
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
  try {
    return await work(scoped);
  } finally {
    active = false;
    operation.dispose();
  }
}
