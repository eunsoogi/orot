import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

/** One loopback connection binds each XCTest boundary to host preparation; host exit closes the waiting client. */
export async function executeIosFixtureSession({ identifiers, command, handle, environment = {} }) {
  // The runner's lifecycle barrier uses XCUIApplication; app-hosted integration targets must not enter this session.
  if (
    !identifiers.length ||
    identifiers.some((identifier) => !identifier.startsWith('OrotUITests/'))
  )
    throw new Error('Fixture sessions require explicit UI test identifiers');
  const session = randomUUID();
  const seen = new Set();
  const entered = new Set();
  const sockets = new Set();
  let active;
  let child;
  let finished = false;
  let failure;
  let pending;
  const cancel = (signal) => {
    failure ??= new Error('Fixture session cancelled by ' + signal);
    for (const socket of sockets) socket.destroy();
    // Only the process group created for this session is eligible for cancellation.
    if (child && !finished) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') failure ??= error;
      }
    }
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    let input = '';
    let received = false;
    let responded = false;
    socket.setEncoding('utf8');
    socket.on('error', (error) => {
      failure ??= error;
      cancel('SIGTERM');
    });
    socket.on('close', () => {
      sockets.delete(socket);
      if (!responded && !finished) {
        failure ??= new Error('Fixture runner disconnected before its boundary completed');
        cancel('SIGTERM');
      }
    });
    socket.on('data', (data) => {
      input += data;
      if (received || input.length > 65536) {
        failure ??= new Error('Invalid or oversized fixture boundary request');
        cancel('SIGTERM');
        return;
      }
      if (!input.endsWith('\n')) return;
      received = true;
      if (pending || finished) {
        failure ??= new Error('Overlapping or post-exit fixture boundary');
        cancel('SIGTERM');
        return;
      }
      pending = (async () => {
        let request;
        let identifier;
        let error;
        try {
          request = JSON.parse(input);
          identifier = identifiers.find((id) => {
            const [target, name, method] = id.split('/');
            // XCTestCase.name omits the Swift module on device; result logs may qualify it.
            return [`-[${name} ${method}]`, `-[${target}.${name} ${method}]`].includes(
              request.name,
            );
          });
          if (request.session !== session || !/^[a-f0-9-]{36}$/i.test(request.token ?? ''))
            throw new Error('Invalid fixture session identity or request token');
          if (seen.has(request.token))
            throw new Error('Fixture request token reused for a different boundary');
          seen.add(request.token);
          if (!identifier || !['prepare', 'complete'].includes(request.stage))
            throw new Error('Unknown fixture session case or stage');
          if (request.stage === 'prepare') {
            if (failure || active || entered.has(identifier))
              throw new Error('Repeated, overlapping or post-failure fixture preparation');
            entered.add(identifier);
            active = identifier;
          } else if (active !== identifier || typeof request.passed !== 'boolean')
            throw new Error('Fixture completion does not match its prepared case');
          await handle({ ...request, identifier });
          if (request.stage === 'complete') {
            active = undefined;
            if (!request.passed)
              failure ??= new Error('Original fixture case failed: ' + identifier);
          }
          if (socket.destroyed || finished) throw failure ?? new Error('Fixture runner exited');
        } catch (caught) {
          error = caught;
          failure ??= caught;
        }
        console.log(
          'IOS_FIXTURE_BOUNDARY ' +
            JSON.stringify({ ...request, identifier, ok: !error, error: error && String(error) }),
        );
        responded = true;
        // EOF terminates the client's read. A lost host/connection produces no valid acknowledgement.
        socket.end(
          JSON.stringify({
            session,
            token: request?.token,
            ok: !error,
            error: error && String(error),
          }),
        );
      })().finally(() => {
        pending = undefined;
      });
    });
  });
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    server.on('error', (error) => {
      failure ??= error;
      cancel('SIGTERM');
    });
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      detached: true,
      env: {
        ...process.env,
        // Forward invocation-scoped diagnostics; the session transport identity remains authoritative.
        ...environment,
        TEST_RUNNER_OROT_IOS_FIXTURE_SESSION: session,
        TEST_RUNNER_OROT_IOS_FIXTURE_PORT: String(server.address().port),
      },
    });
    const status = await new Promise((resolve) => {
      child.once('error', (error) => {
        failure ??= error;
        resolve(1);
      });
      child.once('exit', (code, signal) => resolve(signal ? 1 : code));
    });
    finished = true;
    for (const socket of sockets) socket.destroy();
    // Host cleanup already in flight must finish before ownership can be released.
    await pending;
    return { status, failure: failure && String(failure), entered: [...entered], session };
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}
