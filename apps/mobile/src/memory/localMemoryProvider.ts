import { LocalE5EmbeddingProvider } from '../rag/localE5EmbeddingProvider';
import { localE5NativeBackend } from '../rag/localE5NativeBackend';
let embedder: LocalE5EmbeddingProvider | undefined;
/** A single on-device provider identity is shared by reviewed and user-stated memory. */
export function localMemoryProvider() {
  return (embedder ??= new LocalE5EmbeddingProvider(localE5NativeBackend));
}
