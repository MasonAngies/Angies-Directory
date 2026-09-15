import assert from 'node:assert/strict';
import test from 'node:test';

import { createKintoneClient, escapeQueryValue, KintoneError, normalizeBaseUrl } from '../src/kintone/client.js';

const TOKEN = 'secret-token-value';
const json = (status, body, headers = {}) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(sequence, options = {}) {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, init) : next;
  };
  const client = createKintoneClient({
    baseUrl: 'https://example.kintone.com/',
    apiToken: TOKEN,
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0.5,
    ...options,
  });
  return { client, calls, sleeps };
}

test('GET requests carry the token header and indexed array parameters', async () => {
  const { client, calls } = setup([json(200, { records: [] })]);
  await client.get('records', { app: '897', query: 'Store_Number = "1"', fields: ['$id', 'Store_Number'] });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://example.kintone.com/k/v1/records.json');
  assert.equal(url.searchParams.get('fields[1]'), 'Store_Number');
  assert.equal(calls[0].init.headers['X-Cybozu-API-Token'], TOKEN);
  assert.equal(calls[0].init.body, undefined);
});

test('throttling is retried and Retry-After is honored', async () => {
  const { client, calls, sleeps } = setup([json(429, { code: 'GAIA_TM12' }, { 'retry-after': '2' }), json(200, { ok: true })]);
  assert.deepEqual(await client.get('app', { id: '1' }), { ok: true });
  assert.equal(calls.length, 2);
  assert.ok(sleeps[0] >= 2000);
});

test('transient server errors retry with bounded attempts, then fail as retryable', async () => {
  const { client, calls, sleeps } = setup([json(503, {}), json(503, {}), json(503, { message: 'down' })]);
  await assert.rejects(client.get('app', { id: '1' }), (error) => error instanceof KintoneError && error.status === 503 && error.retryable);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [225, 450], 'exponential backoff with jitter');
});

test('validation and authentication failures are not retried', async () => {
  for (const status of [400, 401, 403, 404]) {
    const { client, calls } = setup([json(status, { code: 'CB_VA01', message: 'bad', errors: { query: {} } })]);
    await assert.rejects(client.get('records', { app: '1' }), (error) => error.status === status && !error.retryable && error.code === 'CB_VA01');
    assert.equal(calls.length, 1, `HTTP ${status}`);
  }
});

test('network failures retry for reads but not for POST, which may have been applied', async () => {
  const read = setup([new TypeError('fetch failed'), json(200, { ok: true })]);
  assert.deepEqual(await read.client.get('app', { id: '1' }), { ok: true });

  const write = setup([new TypeError('fetch failed')]);
  await assert.rejects(write.client.post('record', { app: '1' }), (error) => error.code === 'NETWORK_ERROR' && !error.retryable);
  assert.equal(write.calls.length, 1);

  const serverError = setup([json(503, {})]);
  await assert.rejects(serverError.client.post('record', { app: '1' }));
  assert.equal(serverError.calls.length, 1);

  const throttled = setup([json(429, {}), json(200, { id: '5' })]);
  assert.deepEqual(await throttled.client.post('record', { app: '1' }), { id: '5' });
});

test('timeouts are reported as TIMEOUT', async () => {
  const { client } = setup([new DOMException('timed out', 'TimeoutError')], { maxAttempts: 1 });
  await assert.rejects(client.get('app', { id: '1' }), (error) => error.code === 'TIMEOUT');
});

test('errors never contain the API token', async () => {
  const { client } = setup([json(401, { message: 'invalid token' })]);
  const error = await client.get('app', { id: '1' }).catch((e) => e);
  assert.ok(!JSON.stringify({ message: error.message, ...error }).includes(TOKEN));
});

test('query values are escaped and base URLs must be https', () => {
  assert.equal(escapeQueryValue('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(escapeQueryValue('11101" or Store_Number != "'), '"11101\\" or Store_Number != \\""');
  assert.equal(normalizeBaseUrl('https://example.kintone.com/k/'), 'https://example.kintone.com');
  assert.throws(() => normalizeBaseUrl('http://example.kintone.com'));
  assert.throws(() => normalizeBaseUrl('not a url'));
});

test('getAllRecords pages by $id until a short page', async () => {
  const page = (from, count) => ({ records: Array.from({ length: count }, (_, i) => ({ $id: { value: String(from + i) } })) });
  const { client, calls } = setup([json(200, page(1, 500)), json(200, page(501, 2))]);
  const records = await client.getAllRecords({ app: '1', condition: 'Active_Status in ("Active")', fields: ['Store_Number'] });
  assert.equal(records.length, 502);
  const queries = calls.map((call) => new URL(call.url).searchParams.get('query'));
  assert.deepEqual(queries, [
    '(Active_Status in ("Active")) and $id > 0 order by $id asc limit 500',
    '(Active_Status in ("Active")) and $id > 500 order by $id asc limit 500',
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get('fields[1]'), '$id');
});
