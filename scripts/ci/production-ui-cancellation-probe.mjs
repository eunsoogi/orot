import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

/** A single loopback rendezvous keeps the XCTest probe paused until the host closes it. */
export async function startProductionCancellationProbe({ onReady, onFailure = () => {} }) {
  const token = randomUUID();
  const sockets = new Set();
  let accepted = false;
  let cancellationRequested = false;
  let closing = false;
  let failure;
  const fail = (message) => {
    if (!failure && !closing) {
      failure = new Error(message);
      onFailure(failure);
    }
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    let frame = '';
    let complete = false;
    socket.setEncoding('utf8');
    socket.on('error', () => fail('Production cancellation probe socket failed'));
    socket.on('close', () => {
      sockets.delete(socket);
      if (!closing && !cancellationRequested) fail('Production cancellation probe disconnected');
    });
    socket.on('data', (part) => {
      frame += part;
      if (complete || frame.length > 128)
        return fail('Invalid production cancellation probe frame');
      if (!frame.includes('\n')) return;
      complete = true;
      const match = frame.match(/^v1 ready ([a-f0-9-]+) ([1-9][0-9]*)\n$/i);
      if (accepted || !match || match[1] !== token || !Number.isSafeInteger(Number(match[2])))
        return fail('Invalid production cancellation probe identity');
      accepted = true;
      try {
        onReady({ runnerPid: Number(match[2]) });
      } catch {
        fail('Production cancellation probe readiness failed');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.on('error', () => fail('Production cancellation probe listener failed'));
  return {
    port: server.address().port,
    token,
    get failure() {
      return failure;
    },
    markCancellationRequested() {
      if (!accepted || failure || closing)
        throw new Error('Production cancellation probe is not ready');
      cancellationRequested = true;
    },
    async close() {
      closing = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
