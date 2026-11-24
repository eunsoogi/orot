import { createHealthContextTool } from '../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { canonicalHealthBinding } from '../../voiceSettings/liveCanonicalHealthBinding';
import { canonicalLiveHealthRegistration } from '../canonicalLiveHealthRegistration';

test('current owned v2 registration uses exact canonical descriptor; no local or provider read', () => {
  const read = jest.fn();
  const canonical = createHealthContextTool(
    read,
    new LocalEvidenceReferenceRegistry(),
    'rag',
  );
  const legacy = 'a'.repeat(64);
  const binding = canonicalHealthBinding(
    'b'.repeat(64),
    {
      backendModel: 'gpt-6-luna',
      generation: legacy,
      grantID: legacy + '-model',
    },
    'c'.repeat(64),
  );
  let current = true;
  const receipt = {
    binding,
    current: () => current,
    subscribe: () => () => {},
  };
  const config = canonicalLiveHealthRegistration(receipt);
  expect(config?.canonicalHealthGrant).toEqual(binding);
  expect(config?.canonicalHealthDeclaration).toEqual({
    name: canonical.id,
    parameters: canonical.inputSchema,
    description: canonical.description,
    strict: false,
  });
  current = false;
  expect(canonicalLiveHealthRegistration(receipt)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});
