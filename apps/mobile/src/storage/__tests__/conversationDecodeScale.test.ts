import { decodeConversationArtifact } from '../conversationArtifactCodec';
import * as evidence from '../../aiFeatures/integration/evidenceUtils';

import { serialized } from '../../../test-support/conversationDecodeFixture';

test.each([100, 500, 1332])(
  'measures fresh decode with %i matching citations',
  count => {
    const input = serialized(count);
    const spy = jest.spyOn(evidence, 'stableJson');
    try {
      const start = performance.now();
      const decoded = decodeConversationArtifact(input);
      const ms = performance.now() - start;
      expect(decoded).not.toBeNull();
      expect(spy.mock.calls).toHaveLength(count * 2);
      expect(decoded?.citations).toHaveLength(count);
      console.log(JSON.stringify({ count, ms, calls: spy.mock.calls.length }));
    } finally {
      spy.mockRestore();
    }
  },
);
