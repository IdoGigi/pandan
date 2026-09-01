/**
 * Live updates over Server-Sent Events.
 *
 * Every successful write to /api bumps a revision number and pings each open
 * browser. The browser then re-reads the board. Sending a number rather than
 * the change itself keeps this simple: there is one code path, and a client
 * that missed a ping still catches up on the next one.
 */

const clients = new Set();
let revision = 0;

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(res);
  }
}

/** Called after a write succeeds. Tells every open browser to re-read. */
export function notifyChange(source) {
  revision += 1;
  for (const res of clients) send(res, 'change', { revision, source });
}

/**
 * Bumps the revision after any successful write, so routes do not each have to
 * remember to do it. Reads and failures are ignored.
 */
export function changeNotifier(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.on('finish', () => {
    if (res.statusCode < 400) notifyChange(`${req.method} ${req.path}`);
  });
  next();
}

export function eventsHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops a proxy from holding the stream in a buffer.
    'X-Accel-Buffering': 'no',
  });

  // Tell the browser how long to wait before reconnecting, then say hello so
  // it knows the stream is open.
  res.write('retry: 3000\n\n');
  send(res, 'hello', { revision });

  clients.add(res);

  // Idle connections get dropped by proxies, so send a comment now and then.
  const beat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(beat);
      clients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(beat);
    clients.delete(res);
  });
}

export const openConnections = () => clients.size;
