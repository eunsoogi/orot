import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  updateDirectPhotoPresentations,
  type DirectPhotoPresentation,
  type PublishDirectPhoto,
} from './directPhotoPresentation';

const empty: readonly DirectPhotoPresentation[] = [];
const Value = createContext(empty);
const Publish = createContext<PublishDirectPhoto | undefined>(undefined);

/** The active Conversation workspace alone owns the mounted image preview. */
export function DirectPhotoPresentationScope({
  sessionId,
  available,
  children,
}: {
  readonly sessionId: number;
  readonly available: boolean;
  readonly children: ReactNode;
}) {
  const [value, setValue] = useState(empty);
  const owner = useRef({ available, sessionId });
  owner.current = { available, sessionId };
  const publish = useCallback<PublishDirectPhoto>(event => {
    const current = owner.current;
    if (
      event &&
      'sessionId' in event &&
      (!current.available || current.sessionId !== event.sessionId)
    )
      return;
    setValue(prior => updateDirectPhotoPresentations(prior, event));
  }, []);
  useEffect(() => {
    setValue(prior =>
      available && prior.every(row => row.sessionId === sessionId)
        ? prior
        : empty,
    );
  }, [available, sessionId]);
  return (
    <Publish.Provider value={publish}>
      <Value.Provider
        value={
          available && value.every(row => row.sessionId === sessionId)
            ? value
            : empty
        }
      >
        {children}
      </Value.Provider>
    </Publish.Provider>
  );
}

export function useDirectPhotoPublisher() {
  return useContext(Publish);
}

export function useDirectPhotoPresentation() {
  return useContext(Value);
}
