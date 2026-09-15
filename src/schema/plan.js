// Diffs the desired app definition against the app's current (preview)
// settings. Changes are additive: fields and drop-down options are never
// deleted, and views or layout rows the spec does not own are preserved.

const SYSTEM_TYPES = new Set([
  'STATUS',
  'STATUS_ASSIGNEE',
  'CATEGORY',
  'RECORD_NUMBER',
  'CREATOR',
  'CREATED_TIME',
  'MODIFIER',
  'UPDATED_TIME',
]);

const optionLabels = (options) =>
  Object.values(options ?? {})
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((option) => option.label);

const optionsFrom = (labels) => Object.fromEntries(labels.map((label, index) => [label, { label, index: String(index) }]));

const show = (value) => (value === undefined ? '(unset)' : JSON.stringify(value));

function sameValue(key, desired, current) {
  if (key === 'options') return JSON.stringify(optionLabels(desired)) === JSON.stringify(optionLabels(current));
  if (Array.isArray(desired)) return JSON.stringify(desired) === JSON.stringify(current ?? []);
  return String(desired) === String(current ?? '');
}

export function planFields(desiredFields, currentProperties) {
  const add = {};
  const update = {};
  const conflicts = [];
  const notes = [];

  for (const [code, desired] of Object.entries(desiredFields)) {
    const current = currentProperties[code];
    if (!current) {
      add[code] = desired;
      continue;
    }
    if (current.type !== desired.type) {
      conflicts.push(
        `${code} exists as ${current.type} but the spec requires ${desired.type}. Kintone cannot change a field type; back up its data and rename or remove the field manually.`,
      );
      continue;
    }
    const target = { ...desired };
    if (desired.options) {
      const wanted = optionLabels(desired.options);
      const extras = optionLabels(current.options).filter((label) => !wanted.includes(label));
      if (extras.length) notes.push(`${code}: keeping option(s) added in Kintone that are not in config: ${extras.join(', ')}`);
      target.options = optionsFrom([...wanted, ...extras]);
    }
    const changed = Object.keys(target).filter((key) => key !== 'code' && !sameValue(key, target[key], current[key]));
    if (changed.length) {
      update[code] = {
        properties: target,
        changes: changed.map((key) => `${key}: ${show(key === 'options' ? optionLabels(current[key]) : current[key])} -> ${show(key === 'options' ? optionLabels(target[key]) : target[key])}`),
      };
    }
  }

  const unmanaged = Object.entries(currentProperties)
    .filter(([code, field]) => !desiredFields[code] && !SYSTEM_TYPES.has(field.type))
    .map(([code]) => code);
  return { add, update, conflicts, notes, unmanaged };
}

// Built-in fields placed on the form must exist under the expected codes.
export function checkSystemFieldCodes(layout, currentProperties) {
  const conflicts = [];
  const visit = (elements) => {
    for (const element of elements) {
      if (element.type === 'GROUP') visit(element.layout);
      for (const field of element.fields ?? []) {
        if (SYSTEM_TYPES.has(field.type) && currentProperties[field.code]?.type !== field.type) {
          conflicts.push(`Built-in ${field.type} field is expected under code ${field.code}; update the layout definition to match the app.`);
        }
      }
    }
  };
  visit(layout);
  return conflicts;
}

function projectLayout(elements) {
  return elements.map((element) => {
    if (element.type === 'GROUP') return { type: 'GROUP', code: element.code, layout: projectLayout(element.layout ?? []) };
    return {
      type: element.type,
      fields: (element.fields ?? []).map((field) => ({
        type: field.type,
        code: field.code ?? '',
        label: field.label ?? '',
        width: field.size?.width ?? '',
        innerHeight: field.size?.innerHeight ?? '',
      })),
    };
  });
}

function fieldCodesIn(elements, codes = new Set()) {
  for (const element of elements) {
    if (element.type === 'GROUP') {
      codes.add(element.code);
      fieldCodesIn(element.layout ?? [], codes);
    }
    for (const field of element.fields ?? []) if (field.code) codes.add(field.code);
  }
  return codes;
}

export function planLayout(desiredLayout, currentLayout, unmanagedFieldCodes, currentProperties) {
  // Fields the spec does not own keep a place at the bottom of the form.
  const placed = fieldCodesIn(desiredLayout);
  const extras = unmanagedFieldCodes
    .filter((code) => !placed.has(code) && currentProperties[code])
    .map((code) =>
      currentProperties[code].type === 'GROUP'
        ? { type: 'GROUP', code, layout: [] }
        : { type: 'ROW', fields: [{ type: currentProperties[code].type, code, size: {} }] },
    );
  const layout = [...desiredLayout, ...extras];
  const changed = JSON.stringify(projectLayout(layout)) !== JSON.stringify(projectLayout(currentLayout));
  return { changed, layout };
}

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function projectView(view) {
  return {
    type: view.type,
    name: view.name,
    index: String(view.index),
    fields: view.fields ?? [],
    filterCond: squash(view.filterCond),
    sort: squash(view.sort),
  };
}

export function planViews(desiredViews, currentViews, retiredNames = []) {
  const retired = new Set(retiredNames.filter((name) => !desiredViews[name]));
  const removed = Object.keys(currentViews).filter((name) => retired.has(name));
  const unmanaged = Object.entries(currentViews).filter(([name]) => !desiredViews[name] && !retired.has(name));
  const offset = Object.keys(desiredViews).length;
  const views = { ...desiredViews };
  unmanaged.forEach(([name, view], position) => {
    const { id, builtinType, ...rest } = view;
    views[name] = { ...rest, index: String(offset + position) };
  });

  const added = Object.keys(desiredViews).filter((name) => !currentViews[name]);
  const updated = Object.keys(desiredViews).filter(
    (name) => currentViews[name] && JSON.stringify(projectView(desiredViews[name])) !== JSON.stringify(projectView(currentViews[name])),
  );
  const reindexed = unmanaged.filter(([name, view]) => String(view.index) !== views[name].index).map(([name]) => name);
  return {
    changed: added.length + updated.length + reindexed.length + removed.length > 0,
    added,
    updated,
    removed,
    unmanaged: unmanaged.map(([name]) => name),
    views,
  };
}

const RIGHTS = {
  admins: { appEditable: true, recordViewable: true, recordAddable: true, recordEditable: true, recordDeletable: true, recordImportable: true, recordExportable: true },
  editors: { appEditable: false, recordViewable: true, recordAddable: true, recordEditable: true, recordDeletable: false, recordImportable: false, recordExportable: true },
  readers: { appEditable: false, recordViewable: true, recordAddable: false, recordEditable: false, recordDeletable: false, recordImportable: false, recordExportable: false },
};
const ROLE_ORDER = ['admins', 'editors', 'readers'];

// Kintone applies the first matching entry, so an entity may hold only one role.
export function buildPermissions(permissions) {
  const seen = new Set();
  const entries = [];
  for (const role of ROLE_ORDER) {
    for (const entity of permissions[role] ?? []) {
      if (!['USER', 'GROUP', 'ORGANIZATION'].includes(entity.type) || !entity.code) {
        throw new Error(`permissions.${role} entries need type USER, GROUP, or ORGANIZATION and a code`);
      }
      const key = `${entity.type}:${entity.code}`;
      if (seen.has(key)) throw new Error(`${key} is listed in more than one permission role`);
      seen.add(key);
      entries.push({ role, entity: { type: entity.type, code: entity.code } });
    }
  }
  if (!entries.some((entry) => entry.role === 'admins')) throw new Error('permissions.admins must list at least one administrator');

  return { rights: entries.map(({ role, entity }) => ({ entity, includeSubs: false, ...RIGHTS[role] })) };
}

const projectRights = (rights) =>
  (rights ?? []).map(({ entity, includeSubs, ...flags }) => ({ entity: `${entity.type}:${entity.code}`, includeSubs: Boolean(includeSubs), ...flags }));

export function planPermissions(permissions, currentAppRights) {
  if (!permissions?.apply) return { managed: false, changed: false };
  const { rights } = buildPermissions(permissions);
  const appChanged = JSON.stringify(projectRights(rights)) !== JSON.stringify(projectRights(currentAppRights));
  return { managed: true, changed: appChanged, appChanged, rights };
}

export async function deployAndWait(client, appId, { timeoutMs = 180_000, pollMs = 2_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  await client.post('preview/app/deploy', { apps: [{ app: appId }] });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { apps } = await client.get('preview/app/deploy', { apps: [appId] });
    const { status } = apps[0];
    if (status === 'SUCCESS') return;
    if (status === 'FAIL' || status === 'CANCEL') throw new Error(`Kintone deploy finished with status ${status}`);
    if (Date.now() > deadline) throw new Error('Kintone deploy did not finish in time; check the app settings page.');
    await sleep(pollMs);
  }
}
