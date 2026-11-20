import { createAiFeatureServices } from '../../aiFeatures/integration/featureServices';

// Exercise the real preflight path without a selected model, disclosure, or provider.
export function noProviderFixture(load: () => Promise<null>) {
  const ragRunner = jest.fn();
  const authorize = jest.fn();
  const services = createAiFeatureServices(
    { authorize },
    {
      selectedAi: {
        selectionStore: { load, clear: jest.fn(), save: jest.fn() },
      },
      ragRunner,
    },
  );
  const onSend = jest.fn(services.sendRagMessage);
  return { services, onSend, ragRunner, authorize };
}
