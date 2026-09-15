import { readFileSync } from 'node:fs';

const DEFAULT_DIRECTORY_CONFIG = new URL('../config/directory.config.json', import.meta.url);

export function loadEnvConfig(env = process.env) {
  const missing = ['KINTONE_BASE_URL', 'KINTONE_APP_ID', 'KINTONE_API_TOKEN'].filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  if (!/^\d+$/.test(env.KINTONE_APP_ID)) throw new Error('KINTONE_APP_ID must be a numeric app ID');
  return { baseUrl: env.KINTONE_BASE_URL, appId: env.KINTONE_APP_ID, apiToken: env.KINTONE_API_TOKEN };
}

function optionList(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '' || item !== item.trim())) {
    throw new Error(`${name} must be an array of non-empty, trimmed strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${name} contains duplicate values`);
  return value;
}

export function parseDirectoryConfig(raw) {
  const { storeNumberPattern, verificationMaxAgeDays, timeZone } = raw;
  if (typeof storeNumberPattern !== 'string' || !storeNumberPattern.startsWith('^') || !storeNumberPattern.endsWith('$')) {
    throw new Error('storeNumberPattern must be an anchored regular expression (^...$)');
  }
  if (!Number.isInteger(verificationMaxAgeDays) || verificationMaxAgeDays < 1) {
    throw new Error('verificationMaxAgeDays must be a positive integer');
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    throw new Error(`timeZone "${timeZone}" is not a valid IANA time zone`);
  }
  return {
    storeNumberPattern: new RegExp(storeNumberPattern),
    storeNumberExample: raw.storeNumberExample ?? '',
    concepts: optionList(raw.concepts, 'concepts'),
    verificationMaxAgeDays,
    timeZone,
  };
}

export function loadDirectoryConfig(path = DEFAULT_DIRECTORY_CONFIG) {
  return parseDirectoryConfig(JSON.parse(readFileSync(path, 'utf8')));
}

// Concept options live in Kintone, so an admin can add one in the app without a
// code change. Live options take precedence over config.
export async function withLiveOptions(config, client, appId) {
  const { properties } = await client.get('app/form/fields', { app: appId });
  const options = properties.Concept?.options;
  if (!options) return config;
  const concepts = Object.values(options)
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((option) => option.label);
  return { ...config, concepts };
}
