import { createContext, useContext } from 'react';

/** Only built-in storage may substitute its indexed page for an injected source reader. */
export const RecordsSourcePaging = createContext(false);
export const useRecordsSourcePaging = () => useContext(RecordsSourcePaging);
