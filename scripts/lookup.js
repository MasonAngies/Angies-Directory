#!/usr/bin/env node
// Operator check of the read-only lookup contract:
//   npm run lookup -- 11101
import { parseArgs } from 'node:util';

import { loadDirectoryConfig, loadEnvConfig } from '../src/config.js';
import { createKintoneClient } from '../src/kintone/client.js';
import { createDirectoryLookup } from '../src/lookup/getStoreDirectoryRecord.js';

const { positionals } = parseArgs({ allowPositionals: true });

try {
  if (positionals.length !== 1) throw new Error('Usage: npm run lookup -- <storeNumber>');
  const env = loadEnvConfig();
  const lookup = createDirectoryLookup({
    client: createKintoneClient(env),
    appId: env.appId,
    config: loadDirectoryConfig(),
    logger: (event) => console.error(JSON.stringify(event)),
  });
  const result = await lookup({ storeNumber: positionals[0], correlationId: `cli-${Date.now()}` });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`Lookup failed: ${error.message}`);
  process.exitCode = 2;
}
