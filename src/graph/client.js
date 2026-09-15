// Microsoft Graph client for uploading one file to a SharePoint document
// library, using app-only (client credentials) auth. Tokens and secrets are
// never logged; errors carry status and Graph error code only.

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const LOGIN_HOST = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(message, { status = null, code = null, retryable = false } = {}) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const encodePath = (path) =>
  path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export function createGraphClient({
  tenantId,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  maxAttempts = 3,
  baseDelayMs = 500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  for (const [name, value] of Object.entries({ tenantId, clientId, clientSecret })) {
    if (!value) throw new Error(`Microsoft Graph ${name} is required`);
  }
  let cachedToken = null;

  async function send(url, init, { label }) {
    for (let attempt = 1; ; attempt += 1) {
      let response;
      let body;
      try {
        response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        const text = await response.text();
        body = text ? JSON.parse(text) : null;
      } catch (cause) {
        const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
        if (!(cause instanceof SyntaxError) && attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw new GraphError(`Graph ${label} ${timedOut ? 'timed out' : 'request failed'}`, { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', retryable: true });
      }
      if (response.ok) return body;

      const retryable = RETRYABLE_STATUS.has(response.status);
      const code = body?.error?.code ?? body?.error ?? null;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      throw new GraphError(`Graph ${label} failed with HTTP ${response.status}${code ? ` (${code})` : ''}`, {
        status: response.status,
        code,
        retryable,
      });
    }
  }

  async function accessToken() {
    if (cachedToken && cachedToken.expiresAt > now() + 60_000) return cachedToken.value;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const token = await send(
      `${LOGIN_HOST}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
      { label: 'token request' },
    );
    cachedToken = { value: token.access_token, expiresAt: now() + Number(token.expires_in ?? 3600) * 1000 };
    return cachedToken.value;
  }

  async function get(path, label) {
    return send(`${GRAPH}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${await accessToken()}` } }, { label });
  }

  return {
    // host: contoso.sharepoint.com, sitePath: /sites/StoreOperations
    async resolveSite(host, sitePath) {
      const site = await get(`/sites/${host}:${sitePath.startsWith('/') ? sitePath : `/${sitePath}`}`, 'site lookup');
      return { id: site.id, name: site.displayName, webUrl: site.webUrl };
    },

    async resolveDrive(siteId, libraryName) {
      const { value: drives } = await get(`/sites/${siteId}/drives`, 'drive list');
      const wanted = (libraryName ?? '').trim().toLowerCase();
      const drive =
        (wanted && drives.find((d) => d.name.toLowerCase() === wanted)) ||
        drives.find((d) => ['documents', 'shared documents'].includes(d.name.toLowerCase())) ||
        drives[0];
      if (!drive) throw new GraphError('The site has no document library', { code: 'NO_DRIVE' });
      return { id: drive.id, name: drive.name, webUrl: drive.webUrl };
    },

    // Simple upload; Graph allows up to 250MB this way and the directory is tiny.
    async uploadFile({ driveId, folder, fileName, data, contentType = 'application/octet-stream' }) {
      const path = [folder, fileName].filter(Boolean).join('/');
      const result = await send(
        `${GRAPH}/drives/${driveId}/root:/${encodePath(path)}:/content`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': contentType },
          body: data,
        },
        { label: 'file upload' },
      );
      return { name: result.name, size: result.size, webUrl: result.webUrl, lastModified: result.lastModifiedDateTime };
    },
  };
}
