// Server-Sent Events hub. Staff clients subscribe to all operational events;
// customers subscribe to a single order by its public code.
const staffClients = new Set();
const orderWatchers = new Map(); // code -> Set<res>

function open(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  return () => clearInterval(ping);
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function subscribeStaff(req, res) {
  const stop = open(res);
  const client = { res, user: req.user };
  staffClients.add(client);
  send(res, 'hello', { user: req.user.name });
  req.on('close', () => { stop(); staffClients.delete(client); });
}

export function subscribeOrder(code, req, res) {
  const stop = open(res);
  if (!orderWatchers.has(code)) orderWatchers.set(code, new Set());
  orderWatchers.get(code).add(res);
  req.on('close', () => {
    stop();
    const set = orderWatchers.get(code);
    set?.delete(res);
    if (set && set.size === 0) orderWatchers.delete(code);
  });
}

export function broadcast(event, data) {
  for (const c of staffClients) send(c.res, event, data);
}

export function notifyOrder(code, data) {
  const set = orderWatchers.get(code);
  if (set) for (const res of set) send(res, 'order', data);
}
