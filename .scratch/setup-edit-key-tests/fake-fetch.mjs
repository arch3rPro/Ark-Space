// Synthetic real-entry fixture only. Never reaches the network or writes credentials.
import { appendFileSync } from 'node:fs';
const trace = process.env.ARKS_SETUP_FIXTURE_TRACE;
if (!trace) throw new Error('Fixture trace required.');
const first = 'synthetic-pty?credential-only';
const labels = new Map([[first, 'A'], [first + '-b', 'B'], [first + '-c', 'C'], [first + '-d', 'D']]);
globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== 'https://api.exa.ai/search') throw new Error('Fixture prohibits other network destinations.');
  const label = labels.get(new Headers(init.headers).get('x-api-key'));
  if (!label) throw new Error('Unexpected fixture credential.');
  appendFileSync(trace, label + '\n');
  if (label === 'C') return await new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Fixture cancelled.', 'AbortError'));
    if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
  });
  return new Response(JSON.stringify(label === 'B' ? { error: first + '-b' } : { results: [] }), { status: label === 'B' ? 401 : 200 });
};
