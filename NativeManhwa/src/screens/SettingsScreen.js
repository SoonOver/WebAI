import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
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
  canUseAppUpdates,
  checkForAppUpdate,
  reloadAppUpdate,
} from '../services/appUpdates';

const APP_VERSION = '1.1.0';
const CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}imgcache/`
  : null;
const CACHE_AVAILABLE = Platform.OS !== 'web';

export default function SettingsScreen() {
  const [settings, setSettings] = useState({
    autoAdvance: false,
    cacheEnabled: true,
    imageQuality: 'sharp',
    readerMode: 'webtoon',
    theme: 'dark',
  });
  const [cacheInfo, setCacheInfo] = useState({ exists: false, count: 0 });
  const [historyCount, setHistoryCount] = useState(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      loadSettings();
      checkCacheStatus();
      loadHistoryCount();
    }, [loadSettings, checkCacheStatus, loadHistoryCount])
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
          'A new update has been downloaded. Restart the app now?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Restart', onPress: reloadAppUpdate },
          ]
        );
      } else {
        Alert.alert('App updates', 'You are already on the latest update.');
      }
    } catch {
      Alert.alert('App updates', 'Unable to check for updates right now.');
    } finally {
      setCheckingUpdate(false);
    }
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Settings" subtitle="App preferences" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                  {settings.imageQuality === 'sharp'
                    ? 'Sharp source pixels'
                    : 'Full screen width'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() =>
                updateSetting(
                  'imageQuality',
                  settings.imageQuality === 'sharp' ? 'full' : 'sharp',
                )
              }
              activeOpacity={0.75}
            >
              <Ionicons
                name={settings.imageQuality === 'sharp' ? 'scan' : 'expand'}
                size={16}
                color={THEME.text}
              />
              <Text style={styles.modeBtnText}>
                {settings.imageQuality === 'sharp' ? 'Sharp' : 'Full'}
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
                <Text style={styles.rowLabel}>NativeManhwa</Text>
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
                  name="cloud-download-outline"
                  size={20}
                  color={updatesAvailable ? THEME.success : THEME.textMuted}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>App updates</Text>
                <Text style={styles.rowDescription}>
                  {updatesAvailable
                    ? 'Auto-checks on launch via EAS Update'
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
  bottomSpacer: {
    height: THEME.space.xl * 4,
  },
});
