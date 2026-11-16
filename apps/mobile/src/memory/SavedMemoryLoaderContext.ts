import { createContext } from 'react';
import { loadUnifiedLocalMemories } from './unifiedSavedMemories';

/** Production uses protected storage; admitted native fixtures can inject one failed read. */
export const SavedMemoryLoaderContext = createContext(loadUnifiedLocalMemories);
