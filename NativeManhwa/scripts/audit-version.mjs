import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function readText(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const appJson = readJson('app.json');
const packageJson = readJson('package.json');
const lockJson = readJson('package-lock.json');
const easJson = readJson('eas.json');
const settingsScreen = readText('src/screens/SettingsScreen.js');

const expo = appJson.expo || {};
const packageVersion = packageJson.version;
const appVersion = expo.version;
const lockVersion = lockJson.version;
const lockRootVersion = lockJson.packages?.['']?.version;
const appVersionLiteral = settingsScreen.match(/const APP_VERSION = '([^']+)'/)?.[1];
const versionCode = expo.android?.versionCode;

assert(packageVersion === appVersion, `package.json version ${packageVersion} != app.json version ${appVersion}`);
assert(lockVersion === packageVersion, `package-lock top version ${lockVersion} != package.json version ${packageVersion}`);
assert(lockRootVersion === packageVersion, `package-lock root version ${lockRootVersion} != package.json version ${packageVersion}`);
assert(appVersionLiteral === packageVersion, `Settings APP_VERSION ${appVersionLiteral} != package.json version ${packageVersion}`);
assert(/^\d+\.\d+\.\d+$/.test(packageVersion), `version ${packageVersion} is not semver x.y.z`);
assert(Number.isInteger(versionCode) && versionCode > 0, `android.versionCode ${versionCode} must be a positive integer`);

assert(!('jsEngine' in expo), 'expo.jsEngine must not be set');
assert(!('jsEngine' in (expo.android || {})), 'expo.android.jsEngine must not be set');
assert(packageJson.dependencies?.['expo-updates'], 'expo-updates dependency is missing');
assert(expo.runtimeVersion?.policy === 'appVersion', 'runtimeVersion.policy must be appVersion');
assert(expo.updates?.enabled === true, 'updates.enabled must be true');
assert(typeof expo.updates?.url === 'string' && expo.updates.url.startsWith('https://u.expo.dev/'), 'updates.url must point to EAS Update');
assert(expo.updates?.checkAutomatically === 'ON_LOAD', 'updates.checkAutomatically must be ON_LOAD');
assert(expo.updates?.fallbackToCacheTimeout === 0, 'updates.fallbackToCacheTimeout must be 0');
assert(easJson.cli?.appVersionSource === 'local', 'eas cli.appVersionSource must be local');
assert(easJson.build?.preview?.channel === 'preview', 'preview build channel must be preview');
assert(easJson.build?.production?.channel === 'production', 'production build channel must be production');
assert(packageJson.scripts?.['update:preview']?.includes('--channel preview'), 'update:preview script must publish to preview channel');
assert(packageJson.scripts?.['update:production']?.includes('--channel production'), 'update:production script must publish to production channel');

console.log(JSON.stringify({
  ok: true,
  version: packageVersion,
  androidVersionCode: versionCode,
  runtimeVersionPolicy: expo.runtimeVersion.policy,
  updateUrl: expo.updates.url,
  channels: {
    preview: easJson.build.preview.channel,
    production: easJson.build.production.channel,
  },
}, null, 2));
