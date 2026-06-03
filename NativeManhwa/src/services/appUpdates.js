import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

export function canUseAppUpdates() {
  return Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;
}

export async function checkForAppUpdate() {
  if (!canUseAppUpdates()) {
    return { status: 'unavailable' };
  }

  const update = await Updates.checkForUpdateAsync();
  if (!update.isAvailable) {
    return { status: 'current' };
  }

  await Updates.fetchUpdateAsync();
  return { status: 'ready' };
}

export async function reloadAppUpdate() {
  await Updates.reloadAsync();
}
