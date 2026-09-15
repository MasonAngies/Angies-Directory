#!/usr/bin/env node
// Builds the shared directory workbook and, with --upload, replaces the copy in
// SharePoint so departments without Kintone access can read it.
//   npm run export                 writes exports/<name>.xlsx locally
//   npm run export -- --upload     also uploads it to SharePoint
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadDirectoryConfig, loadEnvConfig, withLiveOptions } from '../src/config.js';
import { todayIn } from '../src/directory/rules.js';
import { buildDirectoryWorkbook } from '../src/export/directory-export.js';
import { createGraphClient } from '../src/graph/client.js';
import { createKintoneClient } from '../src/kintone/client.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function loadSharePointConfig(env = process.env) {
  const required = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'SHAREPOINT_HOST', 'SHAREPOINT_SITE_PATH'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Uploading needs these environment variables: ${missing.join(', ')}`);
  return {
    tenantId: env.GRAPH_TENANT_ID,
    clientId: env.GRAPH_CLIENT_ID,
    clientSecret: env.GRAPH_CLIENT_SECRET,
    host: env.SHAREPOINT_HOST,
    sitePath: env.SHAREPOINT_SITE_PATH,
    library: env.SHAREPOINT_LIBRARY ?? '',
    folder: env.SHAREPOINT_FOLDER ?? '',
    fileName: env.EXPORT_FILE_NAME ?? 'Angies Store Directory.xlsx',
  };
}

async function main() {
  const { values } = parseArgs({ options: { upload: { type: 'boolean', default: false }, out: { type: 'string' } } });
  const env = loadEnvConfig();
  const client = createKintoneClient(env);
  const config = await withLiveOptions(loadDirectoryConfig(), client, env.appId);
  const records = await client.getAllRecords({ app: env.appId });
  const { file, summary } = buildDirectoryWorkbook(records, { config, today: todayIn(config.timeZone) });

  const fileName = process.env.EXPORT_FILE_NAME ?? 'Angies Store Directory.xlsx';
  const outDir = values.out ?? fileURLToPath(new URL('../exports/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const localPath = join(outDir, fileName);
  writeFileSync(localPath, file);
  console.log(`${summary.activeStores} active stores (${summary.completeRows} complete, ${summary.incompleteRows} with gaps) -> ${localPath}`);

  if (!values.upload) {
    console.log('Local file only. Add --upload to replace the SharePoint copy.');
    return;
  }
  // An empty export would wipe a working file for every reader, so never publish one.
  if (summary.activeStores === 0) throw new Error('The directory returned no active stores; refusing to publish an empty file.');

  const sharePoint = loadSharePointConfig();
  const graph = createGraphClient(sharePoint);
  const site = await graph.resolveSite(sharePoint.host, sharePoint.sitePath);
  const drive = await graph.resolveDrive(site.id, sharePoint.library);
  const uploaded = await graph.uploadFile({
    driveId: drive.id,
    folder: sharePoint.folder,
    fileName: sharePoint.fileName,
    data: file,
    contentType: XLSX_TYPE,
  });
  console.log(`Uploaded to ${site.name} / ${drive.name}: ${uploaded.webUrl} (${uploaded.size} bytes, ${uploaded.lastModified})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Export failed: ${error.message}`);
    process.exitCode = 1;
  });
}
