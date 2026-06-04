import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

export function canUseAppUpdates() {
  return Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;
}

function shortUpdateId(updateId) {
  return typeof updateId === 'string' && updateId
    ? updateId.slice(0, 8)
    : 'embedded';
}

function formatUpdateDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return date.toISOString().replace('T', ' ').slice(0, 16);
  }
}

export function getAppUpdateInfo() {
  const enabled = canUseAppUpdates();
  const channel = typeof Updates.channel === 'string' && Updates.channel
    ? Updates.channel
    : enabled
      ? 'unknown'
      : 'development';

  return {
    enabled,
    channel,
    runtimeVersion: Updates.runtimeVersion || 'unknown',
    updateId: shortUpdateId(Updates.updateId),
    createdAt: formatUpdateDate(Updates.createdAt),
    isEmbeddedLaunch: Updates.isEmbeddedLaunch === true,
    isEmergencyLaunch: Updates.isEmergencyLaunch === true,
    emergencyLaunchReason: Updates.emergencyLaunchReason || '',
  };
}

export async function checkForAppUpdate() {
  if (!canUseAppUpdates()) {
    return { status: 'unavailable' };
  }

  const update = await Updates.checkForUpdateAsync();
  if (!update.isAvailable) {
    return { status: 'current', reason: update.reason || '' };
  }

  const fetched = await Updates.fetchUpdateAsync();
  const updateId =
    fetched?.manifest?.id ||
    update?.manifest?.id ||
    '';
  return { status: 'ready', updateId: shortUpdateId(updateId) };
}

export async function reloadAppUpdate() {
  await Updates.reloadAsync();
}
