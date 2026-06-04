import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MODULE_MANIFEST_VERSION,
  OTA_MODULES,
  getDefaultModuleState,
  getModuleById,
} from '../modules/manifest';

const MODULE_STATE_KEY = '@ota_module_state_v1';

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeModuleState(value) {
  const fallback = getDefaultModuleState();
  const storedEnabled = value?.enabled && typeof value.enabled === 'object'
    ? value.enabled
    : {};
  const enabled = {};

  OTA_MODULES.forEach((module) => {
    if (module.locked) {
      enabled[module.id] = true;
      return;
    }
    if (typeof storedEnabled[module.id] === 'boolean') {
      enabled[module.id] = storedEnabled[module.id];
      return;
    }
    enabled[module.id] = module.enabledByDefault !== false;
  });

  return {
    manifestVersion: MODULE_MANIFEST_VERSION,
    updatedAt: Number.isFinite(Number(value?.updatedAt))
      ? Number(value.updatedAt)
      : fallback.updatedAt,
    enabled,
  };
}

export async function getModuleState() {
  const raw = await AsyncStorage.getItem(MODULE_STATE_KEY);
  return normalizeModuleState(safeParse(raw));
}

export async function saveModuleState(nextState) {
  const normalized = normalizeModuleState({
    ...nextState,
    updatedAt: Date.now(),
  });
  await AsyncStorage.setItem(MODULE_STATE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function setModuleEnabled(moduleId, enabled) {
  const module = getModuleById(moduleId);
  if (!module || module.locked) return getModuleState();
  const current = await getModuleState();
  return saveModuleState({
    ...current,
    enabled: {
      ...current.enabled,
      [moduleId]: Boolean(enabled),
    },
  });
}

export async function resetModuleState() {
  const nextState = normalizeModuleState(getDefaultModuleState());
  await AsyncStorage.setItem(
    MODULE_STATE_KEY,
    JSON.stringify({ ...nextState, updatedAt: Date.now() }),
  );
  return getModuleState();
}

export function isModuleEnabled(state, moduleId) {
  const module = getModuleById(moduleId);
  if (!module) return false;
  if (module.locked) return true;
  const normalized = normalizeModuleState(state);
  return normalized.enabled[moduleId] !== false;
}

export function getEnabledModules(state) {
  return OTA_MODULES.filter((module) => isModuleEnabled(state, module.id));
}

export function isFeatureEnabled(state, featureKey) {
  return getEnabledModules(state).some((module) =>
    Array.isArray(module.features) && module.features.includes(featureKey)
  );
}

export function getModuleContributions(state, key) {
  return getEnabledModules(state)
    .flatMap((module) => {
      const value = module.contributions?.[key];
      return Array.isArray(value) ? value : [];
    })
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

export function summarizeModules(state) {
  const normalized = normalizeModuleState(state);
  const total = OTA_MODULES.length;
  const active = OTA_MODULES.filter((module) => normalized.enabled[module.id] !== false).length;
  const configurable = OTA_MODULES.filter((module) => !module.locked).length;
  return `${active}/${total} active · ${configurable} configurable`;
}

export function getNativeSafeModules() {
  return OTA_MODULES.filter((module) => module.requiresNative !== true);
}
