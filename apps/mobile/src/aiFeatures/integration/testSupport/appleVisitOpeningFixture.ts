import { createAiFeatureServices } from '../featureServices';
import { localData } from '../featureServiceFixtures';

export function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => {
    open = resolve;
  });
  return { wait, open };
}
/** Exposes the production-generated tools without providing real stored records. */
export function visitServices(
  consent: Parameters<typeof createAiFeatureServices>[0],
) {
  // Real local data advertises an artifact catalog. Its lookup stays uncalled
  // here because the mock native reply requests only local record evidence.
  const data = Object.assign(localData([]).data, {
    conversationArtifactDiscovery: jest.fn(),
  });
  return createAiFeatureServices(consent, { loadLocalData: async () => data });
}
