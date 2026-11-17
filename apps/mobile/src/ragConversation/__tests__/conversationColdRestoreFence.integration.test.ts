import { coldSessionFixture as fixture } from '../testSupport/coldSessionFixture';

/** A retained Continue callback cannot execute while protected history is unresolved. */
test.each(['restoring', 'restoreFailed'] as const)(
  'cold Continue waits for the %s boundary to clear',
  async field => {
    const f = await fixture();
    try {
      const inspect = jest.spyOn(f.cold, 'inspect');
      const before = f.session().messages;
      f.updateSession({ [field]: true });
      await f.requests.resumeCold(1, 'request');
      expect(inspect).not.toHaveBeenCalled();
      expect(f.begin).not.toHaveBeenCalled();
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.session().messages).toBe(before);
      expect(f.session().draft).toBe('unsent next question');
      f.updateSession({ [field]: false });
      await f.requests.resumeCold(1, 'request');
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.createId).not.toHaveBeenCalled();
      expect(f.session().messages).toHaveLength(2);
      expect(f.session().messages[1]?.retainedTurnId).toBe('request');
    } finally {
      f.requests.dispose();
      f.connection.close();
    }
  },
);

/** A restore starting during a protected read must not claim or dispatch the checkpoint. */
test.each(['inspect', 'adopt'] as const)(
  'cold Continue stops before dispatch when restore starts during %s',
  async boundary => {
    const f = await fixture();
    try {
      const resume = jest.spyOn(f.cold, 'resume');
      if (boundary === 'inspect') {
        const inspect = f.cold.inspect;
        jest.spyOn(f.cold, 'inspect').mockImplementation(async (...args) => {
          const result = await inspect(...args);
          f.updateSession({ restoring: true });
          return result;
        });
      } else {
        const adopt = f.retention.adoptTurn;
        jest
          .spyOn(f.retention, 'adoptTurn')
          .mockImplementation(async (...args) => {
            const result = await adopt(...args);
            f.updateSession({ restoreFailed: true });
            return result;
          });
      }
      const before = f.session().messages;
      await f.requests.resumeCold(1, 'request');
      expect(resume).not.toHaveBeenCalled();
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.begin).not.toHaveBeenCalled();
      expect(f.session().messages).toBe(before);
      expect(f.session().messages[1]?.coldResume).toEqual({ attempt: 0 });
      expect(f.session().busy).toBe(false);
      expect(f.session().draft).toBe('unsent next question');
      expect(f.createId).not.toHaveBeenCalled();
      jest.restoreAllMocks();
      f.updateSession({ restoring: false, restoreFailed: false });
      await f.requests.resumeCold(1, 'request');
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.createId).not.toHaveBeenCalled();
      expect(f.session().messages).toHaveLength(2);
      expect(f.session().messages[1]?.retainedTurnId).toBe('request');
    } finally {
      f.requests.dispose();
      f.connection.close();
    }
  },
);
