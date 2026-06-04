import { OTA_MODULES, OTA_CAPABILITIES } from '../src/modules/manifest.js';

const ids = new Set();
const errors = [];

function fail(message) {
  errors.push(message);
}

if (!Array.isArray(OTA_CAPABILITIES) || OTA_CAPABILITIES.length === 0) {
  fail('OTA_CAPABILITIES must describe at least one supported module capability');
}

for (const module of OTA_MODULES) {
  if (!module || typeof module !== 'object') {
    fail('Module entries must be objects');
    continue;
  }
  if (!module.id || typeof module.id !== 'string') fail('Module is missing string id');
  if (ids.has(module.id)) fail(`Duplicate module id: ${module.id}`);
  ids.add(module.id);
  if (!module.title || typeof module.title !== 'string') fail(`${module.id} missing title`);
  if (!module.summary || typeof module.summary !== 'string') fail(`${module.id} missing summary`);
  if (module.requiresNative === true) fail(`${module.id} requires native code and is not OTA-safe`);
  if (!Array.isArray(module.surfaces) || module.surfaces.length === 0) {
    fail(`${module.id} must declare at least one surface`);
  }
  if (!Array.isArray(module.features) || module.features.length === 0) {
    fail(`${module.id} must declare at least one feature`);
  }
}

const result = {
  ok: errors.length === 0,
  moduleCount: OTA_MODULES.length,
  configurableCount: OTA_MODULES.filter((module) => !module.locked).length,
  nativeSafeCount: OTA_MODULES.filter((module) => module.requiresNative !== true).length,
  errors,
};

console.log(JSON.stringify(result, null, 2));

if (errors.length > 0) {
  process.exitCode = 1;
}
