import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME } from '../theme';
import { ScreenHeader } from '../components/UIComponents';
import { Storage, DownloadManager } from '../storage';
import {
  MODULE_FEATURES,
  OTA_CAPABILITIES,
  OTA_MODULES,
  moduleColor,
} from '../modules/manifest';
import {
  canUseAppUpdates,
  checkForAppUpdate,
  getAppUpdateInfo,
  reloadAppUpdate,
} from '../services/appUpdates';
import {
  getProviderHealth,
  scanProviderHealth,
  summarizeProviderHealth,
  isProviderHealthStale,
} from '../services/providerHealth';
import {
  getModuleState,
  isFeatureEnabled,
  normalizeModuleState,
  resetModuleState,
  setModuleEnabled,
  summarizeModules,
} from '../services/moduleRuntime';

const APP_VERSION = '1.1.2';
const CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}imgcache/`
  : null;
const CACHE_AVAILABLE = Platform.OS !== 'web';
const QUALITY_OPTIONS = [
  {
    key: 'full',
    label: 'Full',
    icon: 'expand',
    description: 'Fits webtoon panels to screen width and removes side gutters',
  },
  {
    key: 'sharp',
    label: 'Sharp',
    icon: 'scan',
    description: 'Limits upscaling when a provider only gives low-resolution panels',
  },
  {
    key: 'original',
    label: 'Original',
    icon: 'contract',
    description: 'Keeps original panel width even if side gutters appear',
  },
];

function qualityOption(key) {
  return QUALITY_OPTIONS.find((item) => item.key === key) || QUALITY_OPTIONS[0];
}

function nextQualityKey(key) {
  const index = QUALITY_OPTIONS.findIndex((item) => item.key === key);
  return QUALITY_OPTIONS[(index + 1) % QUALITY_OPTIONS.length].key;
}

function formatCheckedAt(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState({
    autoAdvance: false,
    cacheEnabled: true,
    imageQuality: 'full',
    panelSpacing: 'none',
    readerMode: 'webtoon',
    safeMode: true,
    theme: 'dark',
  });
  const [cacheInfo, setCacheInfo] = useState({ exists: false, count: 0 });
  const [historyCount, setHistoryCount] = useState(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(() => getAppUpdateInfo());
  const [providerHealth, setProviderHealth] = useState([]);
  const [scanningProviderHealth, setScanningProviderHealth] = useState(false);
  const [scanProgress, setScanProgress] = useState(null);
  const [moduleState, setModuleState] = useState(() => normalizeModuleState(null));

  const loadSettings = useCallback(async () => {
    try {
      const s = await Storage.getSettings();
      setSettings(s);
    } catch {
      // defaults already set in state
    }
  }, []);

  const checkCacheStatus = useCallback(async () => {
    try {
      if (!CACHE_AVAILABLE || !CACHE_DIR) {
        setCacheInfo({ exists: false, count: 0 });
        return;
      }
      const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
      if (dirInfo.exists) {
        const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
        setCacheInfo({ exists: true, count: files.length });
      } else {
        setCacheInfo({ exists: false, count: 0 });
      }
    } catch {
      setCacheInfo({ exists: false, count: 0 });
    }
  }, []);

  const loadHistoryCount = useCallback(async () => {
    try {
      const h = await Storage.getHistory();
      setHistoryCount(h.length);
    } catch {
      // ignore
    }
  }, []);

  const loadProviderHealth = useCallback(async () => {
    const health = await getProviderHealth();
    setProviderHealth(health);
  }, []);

  const loadModuleState = useCallback(async () => {
    const state = await getModuleState();
    setModuleState(state);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
      checkCacheStatus();
      loadHistoryCount();
      loadProviderHealth();
      loadModuleState();
      setUpdateInfo(getAppUpdateInfo());
    }, [loadSettings, checkCacheStatus, loadHistoryCount, loadProviderHealth, loadModuleState])
  );

  const updateSetting = async (key, value) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await Storage.saveSettings(updated);
    } catch {
      // save silently fails — user will see state revert on next app open
    }
  };

  const handleClearCache = () => {
    if (!CACHE_AVAILABLE) return;
    Alert.alert(
      'Clear Image Cache',
      'This will remove all cached images. They will need to be re-downloaded when viewed again. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await DownloadManager.clearCache();
              await checkCacheStatus();
              Alert.alert('Done', 'Image cache has been cleared.');
            } catch {
              Alert.alert('Error', 'Failed to clear image cache.');
            }
          },
        },
      ]
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear Reading History',
      'This will permanently remove all your reading history. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.setItem('@history', JSON.stringify([]));
              setHistoryCount(0);
              Alert.alert('Done', 'Reading history has been cleared.');
            } catch {
              Alert.alert('Error', 'Failed to clear reading history.');
            }
          },
        },
      ]
    );
  };

  const handleCheckUpdates = async () => {
    if (!canUseAppUpdates()) {
      Alert.alert(
        'App updates',
        'OTA updates are available in installed preview or production builds.'
      );
      return;
    }

    setCheckingUpdate(true);
    try {
      const result = await checkForAppUpdate();
      if (result.status === 'ready') {
        Alert.alert(
          'Update ready',
          result.updateId
            ? `Update ${result.updateId} has been downloaded. Restart the app now?`
            : 'A new update has been downloaded. Restart the app now?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Restart', onPress: reloadAppUpdate },
          ]
        );
      } else {
        Alert.alert(
          'App updates',
          result.reason
            ? `You are already on the latest update.\n\nReason: ${result.reason}`
            : 'You are already on the latest update.'
        );
      }
      setUpdateInfo(getAppUpdateInfo());
    } catch {
      Alert.alert('App updates', 'Unable to check for updates right now.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleScanProviders = async () => {
    if (scanningProviderHealth) return;
    setScanningProviderHealth(true);
    setScanProgress(null);
    try {
      const health = await scanProviderHealth((progress) => {
        setScanProgress(progress);
      });
      setProviderHealth(health);
    } catch {
      Alert.alert('Provider health', 'Failed to scan providers right now.');
    } finally {
      setScanningProviderHealth(false);
      setScanProgress(null);
    }
  };

  const handleToggleModule = async (moduleId, enabled) => {
    try {
      const nextState = await setModuleEnabled(moduleId, enabled);
      setModuleState(nextState);
    } catch {
      Alert.alert('OTA modules', 'Failed to update this module setting.');
    }
  };

  const handleResetModules = () => {
    Alert.alert(
      'Reset OTA modules',
      'This restores the default module toggles. Core safety modules stay enabled.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            try {
              const nextState = await resetModuleState();
              setModuleState(nextState);
            } catch {
              Alert.alert('OTA modules', 'Failed to reset module settings.');
            }
          },
        },
      ],
    );
  };

  const cacheStatusLabel = () => {
    if (!CACHE_AVAILABLE) return 'Native only';
    if (!cacheInfo.exists) return 'Empty';
    if (cacheInfo.count === 0) return 'Empty';
    const noun = cacheInfo.count === 1 ? 'file' : 'files';
    return `${cacheInfo.count} ${noun} cached`;
  };

  const hasCache = CACHE_AVAILABLE && cacheInfo.exists && cacheInfo.count > 0;
  const hasHistory = historyCount > 0;
  const updatesAvailable = canUseAppUpdates();
  const updateRuntimeLabel = `Channel ${updateInfo.channel} · Runtime ${updateInfo.runtimeVersion}`;
  const updateStatusLabel = updateInfo.enabled
    ? `${updateInfo.isEmbeddedLaunch ? 'Embedded build' : 'OTA update'} · ${updateInfo.updateId}`
    : 'Unavailable in Expo Go or web preview';
  const selectedQuality = qualityOption(settings.imageQuality);
  const providerSummary = summarizeProviderHealth(providerHealth);
  const providerHealthStale = isProviderHealthStale(providerHealth);
  const normalizedModuleState = normalizeModuleState(moduleState);
  const moduleSummary = summarizeModules(normalizedModuleState);
  const providerHealthEnabled = isFeatureEnabled(
    normalizedModuleState,
    MODULE_FEATURES.providerHealthPanel,
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Settings" subtitle="App preferences" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ── Discovery ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Discovery</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color={settings.safeMode ? THEME.success : THEME.warning}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Safe mode</Text>
                <Text style={styles.rowDescription}>
                  Hides adult titles from catalog, search, and quick picks
                </Text>
              </View>
            </View>
            <Switch
              accessibilityLabel="Toggle safe mode"
              value={settings.safeMode}
              onValueChange={(v) => updateSetting('safeMode', v)}
              trackColor={{ false: THEME.border, true: THEME.primaryDark }}
              thumbColor={settings.safeMode ? THEME.primary : THEME.textMuted}
            />
          </View>

          {providerHealthEnabled ? (
            <>
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <View style={styles.iconWrap}>
                    <Ionicons
                      name="pulse-outline"
                      size={20}
                      color={providerHealthStale ? THEME.warning : THEME.primary}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>Provider health</Text>
                    <Text style={styles.rowDescription}>
                      {providerSummary}{providerHealthStale ? ' · scan recommended' : ''}
                    </Text>
                    {scanProgress?.source ? (
                      <Text style={styles.rowDescription}>
                        Checking {scanProgress.source} ({scanProgress.index + 1}/{scanProgress.total})
                      </Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.updateBtn, scanningProviderHealth && styles.updateBtnDisabled]}
                  onPress={handleScanProviders}
                  disabled={scanningProviderHealth}
                  activeOpacity={0.7}
                >
                  {scanningProviderHealth ? (
                    <ActivityIndicator size="small" color={THEME.textMuted} />
                  ) : (
                    <Text style={styles.updateBtnText}>Scan</Text>
                  )}
                </TouchableOpacity>
              </View>

              {providerHealth.length > 0 ? (
                <View style={styles.providerGrid}>
                  {providerHealth.map((entry) => (
                    <View key={entry.source} style={styles.providerHealthRow}>
                      <View
                        style={[
                          styles.providerStatusDot,
                          entry.status === 'ok' && styles.providerStatusOk,
                          entry.status === 'degraded' && styles.providerStatusDegraded,
                          entry.status === 'down' && styles.providerStatusDown,
                        ]}
                      />
                      <View style={styles.providerHealthText}>
                        <Text style={styles.providerHealthName} numberOfLines={1}>
                          {entry.label}
                        </Text>
                        <Text style={styles.providerHealthMeta} numberOfLines={2}>
                          {entry.message} · {entry.latencyMs}ms · {formatCheckedAt(entry.checkedAt)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        {/* ── OTA Modules ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>OTA Modules</Text>
              <Text style={styles.sectionSubtitle}>{moduleSummary}</Text>
            </View>
            <TouchableOpacity
              style={styles.smallActionBtn}
              onPress={handleResetModules}
              activeOpacity={0.72}
            >
              <Ionicons name="refresh-outline" size={14} color={THEME.text} />
              <Text style={styles.smallActionText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.capabilityGrid}>
            {OTA_CAPABILITIES.map((capability) => (
              <View key={capability.key} style={styles.capabilityItem}>
                <Text style={styles.capabilityLabel}>{capability.label}</Text>
                <Text style={styles.capabilityText} numberOfLines={2}>
                  {capability.description}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.moduleList}>
            {OTA_MODULES.map((module) => {
              const enabled = normalizedModuleState.enabled[module.id] !== false;
              const color = moduleColor(THEME, module);
              return (
                <View key={module.id} style={styles.moduleRow}>
                  <View style={[styles.moduleIcon, { borderColor: color }]}>
                    <Ionicons name={module.icon} size={18} color={color} />
                  </View>
                  <View style={styles.moduleText}>
                    <View style={styles.moduleTitleRow}>
                      <Text style={styles.moduleTitle} numberOfLines={1}>
                        {module.title}
                      </Text>
                      <View
                        style={[
                          styles.moduleBadge,
                          enabled ? styles.moduleBadgeActive : styles.moduleBadgeOff,
                        ]}
                      >
                        <Text style={styles.moduleBadgeText}>
                          {module.locked ? 'Core' : enabled ? 'On' : 'Off'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.moduleSummary} numberOfLines={2}>
                      {module.summary}
                    </Text>
                    <Text style={styles.moduleMeta} numberOfLines={1}>
                      {module.category} · {module.surfaces.join(', ')}
                    </Text>
                  </View>
                  {module.locked ? (
                    <Ionicons name="lock-closed-outline" size={18} color={THEME.textMuted} />
                  ) : (
                    <Switch
                      accessibilityLabel={`Toggle ${module.title} module`}
                      value={enabled}
                      onValueChange={(value) => handleToggleModule(module.id, value)}
                      trackColor={{ false: THEME.border, true: THEME.primaryDark }}
                      thumbColor={enabled ? THEME.primary : THEME.textMuted}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Reading ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reading</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="play-skip-forward-outline"
                  size={20}
                  color={THEME.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Auto-advance</Text>
                <Text style={styles.rowDescription}>
                  Automatically go to the next chapter when reaching the end
                </Text>
              </View>
            </View>
            <Switch
              accessibilityLabel="Toggle auto advance"
              value={settings.autoAdvance}
              onValueChange={(v) => updateSetting('autoAdvance', v)}
              trackColor={{ false: THEME.border, true: THEME.primaryDark }}
              thumbColor={settings.autoAdvance ? THEME.primary : THEME.textMuted}
            />
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="book-outline"
                  size={20}
                  color={THEME.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Default reader mode</Text>
                <Text style={styles.rowDescription}>
                  Choose how chapters open in the reader
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() =>
                updateSetting(
                  'readerMode',
                  settings.readerMode === 'manga' ? 'webtoon' : 'manga',
                )
              }
              activeOpacity={0.75}
            >
              <Ionicons
                name={settings.readerMode === 'manga' ? 'book' : 'phone-portrait'}
                size={16}
                color={THEME.text}
              />
              <Text style={styles.modeBtnText}>
                {settings.readerMode === 'manga' ? 'Page' : 'Webtoon'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="image-outline"
                  size={20}
                  color={THEME.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Image quality</Text>
                <Text style={styles.rowDescription}>
                  {selectedQuality.description}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() =>
                updateSetting(
                  'imageQuality',
                  nextQualityKey(settings.imageQuality),
                )
              }
              activeOpacity={0.75}
            >
              <Ionicons
                name={selectedQuality.icon}
                size={16}
                color={THEME.text}
              />
              <Text style={styles.modeBtnText}>
                {selectedQuality.label}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="reorder-three-outline"
                  size={20}
                  color={THEME.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Panel spacing</Text>
                <Text style={styles.rowDescription}>
                  {settings.panelSpacing === 'comfortable'
                    ? 'Adds a small gap between webtoon panels'
                    : 'Keeps webtoon panels tightly connected'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() =>
                updateSetting(
                  'panelSpacing',
                  settings.panelSpacing === 'comfortable' ? 'none' : 'comfortable',
                )
              }
              activeOpacity={0.75}
            >
              <Ionicons
                name={settings.panelSpacing === 'comfortable' ? 'remove-outline' : 'add-outline'}
                size={16}
                color={THEME.text}
              />
              <Text style={styles.modeBtnText}>
                {settings.panelSpacing === 'comfortable' ? 'Gap' : 'Tight'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Cache ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cache</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="images-outline"
                  size={20}
                  color={CACHE_AVAILABLE ? THEME.warning : THEME.textMuted}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Image caching</Text>
                <Text style={styles.rowDescription}>
                  {CACHE_AVAILABLE
                    ? 'Cache chapter images locally for faster loading and offline reading'
                    : 'Image cache uses native device storage and is disabled in web preview'}
                </Text>
              </View>
            </View>
            <Switch
              accessibilityLabel="Toggle image caching"
              value={CACHE_AVAILABLE && settings.cacheEnabled}
              onValueChange={(v) => updateSetting('cacheEnabled', v)}
              disabled={!CACHE_AVAILABLE}
              trackColor={{ false: THEME.border, true: THEME.primaryDark }}
              thumbColor={
                CACHE_AVAILABLE && settings.cacheEnabled ? THEME.primary : THEME.textMuted
              }
            />
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="folder-open-outline"
                  size={20}
                  color={THEME.textSecondary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Cache status</Text>
                <Text style={styles.rowDescription}>
                  {cacheStatusLabel()}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.actionBtn, !hasCache && styles.actionBtnDisabled]}
              onPress={handleClearCache}
              disabled={!hasCache}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.actionBtnText,
                  !hasCache && styles.actionBtnTextDisabled,
                ]}
              >
                Clear
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── History ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>History</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="time-outline"
                  size={20}
                  color={THEME.textSecondary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Reading history</Text>
                <Text style={styles.rowDescription}>
                  {hasHistory
                    ? `${historyCount} entr${historyCount === 1 ? 'y' : 'ies'}`
                    : 'No entries'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                !hasHistory && styles.actionBtnDisabled,
              ]}
              onPress={handleClearHistory}
              disabled={!hasHistory}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.actionBtnText,
                  !hasHistory && styles.actionBtnTextDisabled,
                ]}
              >
                Clear
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── About ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={THEME.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>WibuNgomik</Text>
                <Text style={styles.rowDescription}>
                  Version {APP_VERSION}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="git-branch-outline"
                  size={20}
                  color={updatesAvailable ? THEME.primary : THEME.textMuted}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Running update</Text>
                <Text style={styles.rowDescription}>
                  {updateRuntimeLabel}
                </Text>
                <Text style={styles.rowDescription}>
                  {updateInfo.createdAt ? `${updateStatusLabel} · ${updateInfo.createdAt}` : updateStatusLabel}
                </Text>
                {updateInfo.isEmergencyLaunch && updateInfo.emergencyLaunchReason ? (
                  <Text style={styles.warningText} numberOfLines={2}>
                    {updateInfo.emergencyLaunchReason}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="cloud-download-outline"
                  size={20}
                  color={updatesAvailable ? THEME.success : THEME.textMuted}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>App updates</Text>
                <Text style={styles.rowDescription}>
                  {updatesAvailable
                    ? 'Automatic on launch and app resume via EAS Update'
                    : 'Available in installed Android and iOS builds'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.updateBtn,
                checkingUpdate && styles.updateBtnDisabled,
              ]}
              onPress={handleCheckUpdates}
              disabled={checkingUpdate}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.updateBtnText,
                  checkingUpdate && styles.updateBtnTextDisabled,
                ]}
              >
                {checkingUpdate ? 'Checking' : 'Check'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  scrollContent: {
    paddingBottom: THEME.space.xl * 2,
  },
  section: {
    paddingHorizontal: THEME.space.lg,
    marginTop: THEME.space.xl,
  },
  sectionTitle: {
    color: THEME.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
    marginBottom: THEME.space.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: THEME.space.md,
    marginBottom: THEME.space.md,
  },
  sectionSubtitle: {
    color: THEME.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: -THEME.space.sm,
  },
  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.sm,
  },
  smallActionText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.md,
    marginBottom: THEME.space.sm,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: THEME.space.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: THEME.space.md,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    color: THEME.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  rowDescription: {
    color: THEME.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  warningText: {
    color: THEME.warning,
    fontSize: 12,
    lineHeight: 16,
    marginTop: THEME.space.xs,
  },
  actionBtn: {
    backgroundColor: THEME.danger,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.lg,
    borderRadius: THEME.radius.sm,
  },
  actionBtnDisabled: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  actionBtnText: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: '700',
  },
  actionBtnTextDisabled: {
    color: THEME.textMuted,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: THEME.primaryDark,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.sm,
  },
  modeBtnText: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: '700',
  },
  updateBtn: {
    backgroundColor: THEME.primaryDark,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.lg,
    borderRadius: THEME.radius.sm,
  },
  updateBtnDisabled: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  updateBtnText: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: '700',
  },
  updateBtnTextDisabled: {
    color: THEME.textMuted,
  },
  providerGrid: {
    backgroundColor: THEME.surface,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: 'hidden',
  },
  providerHealthRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  providerStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: THEME.textMuted,
    marginRight: THEME.space.md,
  },
  providerStatusOk: {
    backgroundColor: THEME.success,
  },
  providerStatusDegraded: {
    backgroundColor: THEME.warning,
  },
  providerStatusDown: {
    backgroundColor: THEME.danger,
  },
  providerHealthText: {
    flex: 1,
  },
  providerHealthName: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: '700',
  },
  providerHealthMeta: {
    color: THEME.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  capabilityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: THEME.space.sm,
    marginBottom: THEME.space.sm,
  },
  capabilityItem: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: THEME.surface,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: THEME.space.md,
  },
  capabilityLabel: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  capabilityText: {
    color: THEME.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  moduleList: {
    backgroundColor: THEME.surface,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: 'hidden',
  },
  moduleRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.md,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  moduleIcon: {
    width: 36,
    height: 36,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    backgroundColor: THEME.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: THEME.space.md,
  },
  moduleText: {
    flex: 1,
    marginRight: THEME.space.md,
  },
  moduleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: THEME.space.sm,
  },
  moduleTitle: {
    flex: 1,
    color: THEME.text,
    fontSize: 14,
    fontWeight: '700',
  },
  moduleBadge: {
    borderRadius: THEME.radius.pill,
    paddingVertical: 2,
    paddingHorizontal: THEME.space.sm,
  },
  moduleBadgeActive: {
    backgroundColor: THEME.primaryDark,
  },
  moduleBadgeOff: {
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  moduleBadgeText: {
    color: THEME.text,
    fontSize: 10,
    fontWeight: '800',
  },
  moduleSummary: {
    color: THEME.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  moduleMeta: {
    color: THEME.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  bottomSpacer: {
    height: THEME.space.xl * 4,
  },
});
