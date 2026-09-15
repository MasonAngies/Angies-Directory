import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSharePointConfig } from '../scripts/export-directory.js';
import { createGraphClient } from '../src/graph/client.js';

const SECRET = 'super-secret-client-value';
const json = (status, body, headers = {}) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(sequence) {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createGraphClient({
    tenantId: 'tenant-id',
    clientId: 'client-id',
    clientSecret: SECRET,
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
  });
  return { client, calls, sleeps };
}

const token = () => json(200, { access_token: 'token-value', expires_in: 3600 });

test('a client-credentials token is fetched once and reused', async () => {
  const { client, calls } = setup([
    token(),
    json(200, { name: 'a.xlsx', size: 10, webUrl: 'https://x/a.xlsx', lastModifiedDateTime: '2026-09-15T18:00:00Z' }),
    json(200, { name: 'a.xlsx', size: 11, webUrl: 'https://x/a.xlsx', lastModifiedDateTime: '2026-09-15T19:00:00Z' }),
  ]);
  const upload = () => client.uploadFile({ driveId: 'drive1', folder: 'Store Directory', fileName: 'a.xlsx', data: Buffer.from('x') });
  assert.equal((await upload()).size, 10);
  assert.equal((await upload()).size, 11);

  assert.equal(calls.length, 3, 'one token call, two uploads');
  assert.match(calls[0].url, /^https:\/\/login\.microsoftonline\.com\/tenant-id\/oauth2\/v2\.0\/token$/);
  assert.match(calls[0].init.body, /grant_type=client_credentials/);
  assert.match(calls[0].init.body, /scope=https%3A%2F%2Fgraph\.microsoft\.com%2F\.default/);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer token-value');
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/drives/drive1/root:/Store%20Directory/a.xlsx:/content');
  assert.equal(calls[1].init.method, 'PUT');
});

test('site and library lookups resolve ids, preferring the named library', async () => {
  const drives = { value: [{ id: 'd1', name: 'Documents', webUrl: 'u1' }, { id: 'd2', name: 'Store Files', webUrl: 'u2' }] };
  const named = setup([token(), json(200, drives)]);
  assert.equal((await named.client.resolveDrive('site1', 'Store Files')).id, 'd2');

  const fallback = setup([token(), json(200, drives)]);
  assert.equal((await fallback.client.resolveDrive('site1', '')).id, 'd1', 'defaults to the Documents library');

  const empty = setup([token(), json(200, { value: [] })]);
  await assert.rejects(empty.client.resolveDrive('site1', ''), /no document library/);

  const site = setup([token(), json(200, { id: 'site-id', displayName: 'Store Operations', webUrl: 'https://x/sites/StoreOperations' })]);
  assert.equal((await site.client.resolveSite('contoso.sharepoint.com', '/sites/StoreOperations')).id, 'site-id');
  assert.equal(site.calls[1].url, 'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/StoreOperations');
});

test('throttling is retried; permission errors are not, and no secret leaks', async () => {
  const throttled = setup([token(), json(429, {}, { 'retry-after': '3' }), json(200, { name: 'a.xlsx', size: 1, webUrl: 'u' })]);
  await throttled.client.uploadFile({ driveId: 'd', fileName: 'a.xlsx', data: Buffer.from('x') });
  assert.deepEqual(throttled.sleeps, [3000]);

  const denied = setup([token(), json(403, { error: { code: 'accessDenied', message: 'no' } })]);
  const error = await denied.client.uploadFile({ driveId: 'd', fileName: 'a.xlsx', data: Buffer.from('x') }).catch((e) => e);
  assert.equal(error.status, 403);
  assert.equal(error.code, 'accessDenied');
  assert.equal(denied.calls.length, 2, 'not retried');
  assert.ok(!JSON.stringify({ message: error.message, ...error }).includes(SECRET));
});

test('missing credentials are reported by name, never by value', () => {
  assert.throws(() => createGraphClient({ tenantId: 't', clientId: 'c' }), /clientSecret is required/);
  assert.throws(
    () => loadSharePointConfig({ GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c' }),
    /GRAPH_CLIENT_SECRET, SHAREPOINT_HOST, SHAREPOINT_SITE_PATH/,
  );
  const config = loadSharePointConfig({
    GRAPH_TENANT_ID: 't',
    GRAPH_CLIENT_ID: 'c',
    GRAPH_CLIENT_SECRET: SECRET,
    SHAREPOINT_HOST: 'contoso.sharepoint.com',
    SHAREPOINT_SITE_PATH: '/sites/StoreOperations',
  });
  assert.equal(config.fileName, 'Angies Store Directory.xlsx', 'file name has a default');
  assert.equal(config.folder, '');
});
