import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseStore } from '@langchain/langgraph/web';
import { RememoriLangGraphStore } from '../src/langgraphStore/store';

describe('Rememori LangGraph Store Hermes entry', () => {
  it('extends the portable BaseStore export used by native graph bundles', () => {
    // The Node root export is valid in Jest but imports node:async_hooks in Metro.
    const source = readFileSync(join(__dirname, '../src/langgraphStore/store.ts'), 'utf8');
    const runtimeBaseStoreImport = [
      ...source.matchAll(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/gm),
    ].find(([, bindings]) =>
      bindings
        ?.split(',')
        .some((binding) => binding.trim().replace(/^type\s+/, '') === 'BaseStore'),
    );

    expect(runtimeBaseStoreImport?.[2]).toBe('@langchain/langgraph/web');
    expect(Object.getPrototypeOf(RememoriLangGraphStore.prototype)).toBe(BaseStore.prototype);
  });
});
