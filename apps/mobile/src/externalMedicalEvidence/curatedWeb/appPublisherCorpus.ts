import { createCuratedWebIndex } from './curatedWebIndex';
import { nativePublisherPageLoader } from './nativePublisherPage';

const loader = nativePublisherPageLoader();
export const publisherCorpusAvailable = loader !== undefined;
// Process-lifetime public metadata only. Creating or searching it never performs I/O.
export const appPublisherCorpus = createCuratedWebIndex(loader);
