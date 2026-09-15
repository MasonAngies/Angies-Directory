// Minimal Kintone REST client: API-token auth, request timeouts, and bounded
// retries for transient failures. The token is never included in errors.

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 520]);
const PAGE_SIZE = 500;
const MAX_RETRY_AFTER_MS = 30_000;

export class KintoneError extends Error {
  constructor(message, { status = null, code = null, errorId = null, retryable = false, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'KintoneError';
    this.status = status;
    this.code = code;
    this.errorId = errorId;
    this.retryable = retryable;
    this.details = details;
  }
}

export function normalizeBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl));
  } catch {
    throw new Error('KINTONE_BASE_URL must be a valid URL such as https://example.kintone.com');
  }
  if (url.protocol !== 'https:') throw new Error('KINTONE_BASE_URL must use https');
  return url.origin;
}

// Quotes a value for a Kintone query expression (e.g. Store_Number = "1042").
export function escapeQueryValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function toQueryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item, index) => search.append(`${key}[${index}]`, String(item)));
    else search.append(key, String(value));
  }
  return search.toString();
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

export function createKintoneClient({
  baseUrl,
  apiToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  maxAttempts = 3,
  baseDelayMs = 300,
  maxDelayMs = 5_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  if (!apiToken) throw new Error('KINTONE_API_TOKEN is required');
  const origin = normalizeBaseUrl(baseUrl);

  function backoff(attempt, retryAfterHeader) {
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    const jittered = Math.round(exponential / 2 + random() * (exponential / 2));
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    return retryAfterMs === null ? jittered : Math.max(jittered, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS));
  }

  async function request(method, path, params = {}) {
    const hasBody = method === 'POST' || method === 'PUT';
    const query = !hasBody && Object.keys(params).length ? `?${toQueryString(params)}` : '';
    const url = `${origin}/k/v1/${path}.json${query}`;
    const headers = { 'X-Cybozu-API-Token': apiToken };
    if (hasBody) headers['Content-Type'] = 'application/json';
    // A POST whose outcome is unknown (timeout, 5xx) may have been applied, so
    // only retry it when Kintone explicitly rejected it for throttling.
    const safeToRepeat = method !== 'POST';

    for (let attempt = 1; ; attempt += 1) {
      let response;
      let body;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: hasBody ? JSON.stringify(params) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        body = await readBody(response);
      } catch (cause) {
        const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
        const error = new KintoneError(`Kintone ${method} ${path} ${timedOut ? 'timed out' : 'network request failed'}`, {
          code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
          retryable: safeToRepeat,
          cause,
        });
        if (error.retryable && attempt < maxAttempts) {
          await sleep(backoff(attempt, null));
          continue;
        }
        throw error;
      }

      if (response.ok) return body ?? {};

      const { status } = response;
      const retryable = status === 429 || (safeToRepeat && RETRYABLE_STATUS.has(status));
      const error = new KintoneError(
        `Kintone ${method} ${path} failed with HTTP ${status}${body?.code ? ` (${body.code})` : ''}: ${body?.message ?? 'no message'}`,
        { status, code: body?.code ?? null, errorId: body?.id ?? null, retryable, details: body?.errors },
      );
      if (retryable && attempt < maxAttempts) {
        await sleep(backoff(attempt, response.headers.get('retry-after')));
        continue;
      }
      throw error;
    }
  }

  return {
    get: (path, params) => request('GET', path, params),
    post: (path, params) => request('POST', path, params),
    put: (path, params) => request('PUT', path, params),
    delete: (path, params) => request('DELETE', path, params),

    // Seek pagination on $id so large apps never hit the offset limit.
    async getAllRecords({ app, fields, condition = '' }) {
      const records = [];
      const fieldList = fields ? [...new Set([...fields, '$id'])] : undefined;
      let lastId = 0;
      for (;;) {
        const filter = [condition && `(${condition})`, `$id > ${lastId}`].filter(Boolean).join(' and ');
        const page = await request('GET', 'records', {
          app,
          query: `${filter} order by $id asc limit ${PAGE_SIZE}`,
          fields: fieldList,
        });
        records.push(...page.records);
        if (page.records.length < PAGE_SIZE) return records;
        lastId = Number(page.records.at(-1).$id.value);
      }
    },
  };
}
