#!/usr/bin/env node
// Brings the Kintone app in line with docs/SPEC.md. Dry run by default;
// --apply backs up settings, applies additive changes, deploys, and verifies.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { backupDir, exportAppSettings } from '../src/backup.js';
import { loadDirectoryConfig, loadEnvConfig } from '../src/config.js';
import { createKintoneClient } from '../src/kintone/client.js';
import { buildDefinition } from '../src/schema/definition.js';
import { checkSystemFieldCodes, deployAndWait, planFields, planLayout, planPermissions, planViews } from '../src/schema/plan.js';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });

async function loadState(client, app, { preview }) {
  const prefix = preview ? 'preview/' : '';
  const [fields, layout, views, appAcl, fieldAcl] = await Promise.all([
    client.get(`${prefix}app/form/fields`, { app }),
    client.get(`${prefix}app/form/layout`, { app }),
    client.get(`${prefix}app/views`, { app }),
    client.get(`${prefix}app/acl`, { app }),
    client.get(`${prefix}field/acl`, { app }),
  ]);
  return {
    properties: fields.properties,
    revision: fields.revision,
    layout: layout.layout,
    views: views.views,
    appRights: appAcl.rights,
    fieldRights: fieldAcl.rights,
  };
}

function buildPlan(definition, state, permissions) {
  const fields = planFields(definition.fields, state.properties);
  const layout = planLayout(definition.layout, state.layout, fields.unmanaged, state.properties);
  const views = planViews(definition.views, state.views, definition.retiredViews);
  const perms = planPermissions(permissions, state.appRights, state.fieldRights);
  const conflicts = [...fields.conflicts, ...checkSystemFieldCodes(definition.layout, state.properties)];
  const changed = Object.keys(fields.add).length > 0 || Object.keys(fields.update).length > 0 || layout.changed || views.changed || perms.changed;
  return { fields, layout, views, perms, conflicts, changed };
}

function printPlan(plan) {
  const { fields, layout, views, perms } = plan;
  const lines = [];
  if (Object.keys(fields.add).length) lines.push(`Add fields: ${Object.keys(fields.add).join(', ')}`);
  for (const [code, { changes }] of Object.entries(fields.update)) lines.push(`Update ${code}: ${changes.join('; ')}`);
  for (const note of fields.notes) lines.push(`Note: ${note}`);
  if (fields.unmanaged.length) lines.push(`Left untouched (not in spec): ${fields.unmanaged.join(', ')}`);
  if (layout.changed) lines.push('Replace form layout with the spec layout');
  if (views.added.length) lines.push(`Add views: ${views.added.join(', ')}`);
  if (views.updated.length) lines.push(`Update views: ${views.updated.join(', ')}`);
  if (views.removed.length) lines.push(`Remove retired views: ${views.removed.join(', ')}`);
  if (views.unmanaged.length) lines.push(`Keep other views: ${views.unmanaged.join(', ')}`);
  if (!perms.managed) lines.push('Permissions: not managed (config/permissions.json "apply" is false)');
  else if (perms.changed) lines.push(`Permissions: ${[perms.appChanged && 'app', perms.fieldChanged && 'field'].filter(Boolean).join(' and ')} rights will be replaced`);
  for (const conflict of plan.conflicts) lines.push(`CONFLICT: ${conflict}`);
  console.log(lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- No changes');
}

async function applyPlan(client, app, plan) {
  const { fields, layout, views, perms } = plan;
  if (Object.keys(fields.add).length) await client.post('preview/app/form/fields', { app, properties: fields.add });
  if (Object.keys(fields.update).length) {
    const properties = Object.fromEntries(Object.entries(fields.update).map(([code, entry]) => [code, entry.properties]));
    await client.put('preview/app/form/fields', { app, properties });
  }
  if (layout.changed) await client.put('preview/app/form/layout', { app, layout: layout.layout });
  if (views.changed) await client.put('preview/app/views', { app, views: views.views });
  if (perms.appChanged) await client.put('preview/app/acl', { app, rights: perms.rights });
  if (perms.fieldChanged) await client.put('preview/field/acl', { app, rights: perms.fieldRights });
}

async function main() {
  const env = loadEnvConfig();
  const app = env.appId;
  const config = loadDirectoryConfig();
  const permissions = JSON.parse(readFileSync(new URL('../config/permissions.json', import.meta.url), 'utf8'));
  const client = createKintoneClient(env);
  const definition = buildDefinition(config);

  const [live, preview] = await Promise.all([client.get('app/form/fields', { app }), client.get('preview/app/form/fields', { app })]);
  if (live.revision !== preview.revision) {
    throw new Error(
      `App ${app} has undeployed changes (live revision ${live.revision}, preview ${preview.revision}). Update or discard them in Kintone first so they are not published by accident.`,
    );
  }

  const plan = buildPlan(definition, await loadState(client, app, { preview: true }), permissions);
  console.log(`Plan for app ${app}:`);
  printPlan(plan);
  if (plan.conflicts.length) {
    process.exitCode = 1;
    return;
  }
  if (!plan.changed) {
    console.log('App already matches the spec.');
    return;
  }
  if (!values.apply) {
    console.log('Dry run only. Re-run with --apply to make these changes.');
    return;
  }

  const dir = backupDir('pre-setup');
  await exportAppSettings(client, app, dir);
  console.log(`Backed up current settings to ${dir}`);

  try {
    await applyPlan(client, app, plan);
  } catch (error) {
    await client.post('preview/app/deploy', { apps: [{ app }], revert: true }).catch(() => {});
    throw new Error(`${error.message}${error.details ? `\n${JSON.stringify(error.details, null, 2)}` : ''}\nPreview changes were discarded; the live app is unchanged.`);
  }
  await deployAndWait(client, app);
  console.log('Deployed.');

  const verification = buildPlan(definition, await loadState(client, app, { preview: false }), permissions);
  if (verification.changed || verification.conflicts.length) {
    console.log('Verification found remaining differences:');
    printPlan(verification);
    process.exitCode = 1;
  } else {
    console.log('Verified: the live app matches the spec.');
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
