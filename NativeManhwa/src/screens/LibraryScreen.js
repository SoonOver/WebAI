import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { THEME } from '../theme';
import { Storage, DownloadManager } from '../storage';
import {
  ScreenHeader,
  MangaCard,
  EmptyState,
} from '../components/UIComponents';

const DOWNLOADS_META_KEY = '@downloads_meta';

async function getDownloadsMeta() {
  const val = await AsyncStorage.getItem(DOWNLOADS_META_KEY);
  if (!val) return {};
  try {
    const parsed = JSON.parse(val);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveDownloadsMeta(meta) {
  await AsyncStorage.setItem(DOWNLOADS_META_KEY, JSON.stringify(meta));
}

async function removeDownloadMeta(id) {
  const meta = await getDownloadsMeta();
  delete meta[id];
  await saveDownloadsMeta(meta);
  return meta;
}

function textOr(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export default function LibraryScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('bookmarks');
  const [bookmarks, setBookmarks] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [downloadsMeta, setDownloadsMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBookmarks = useCallback(async () => {
    const data = await Storage.getBookmarks();
    setBookmarks(data);
  }, []);

  const loadDownloads = useCallback(async () => {
    const data = await DownloadManager.getDownloadedList();
    const meta = await getDownloadsMeta();
    setDownloads(data);
    setDownloadsMeta(meta);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadBookmarks(), loadDownloads()]);
    } catch (err) {
      setBookmarks([]);
      setDownloads([]);
      setDownloadsMeta({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadBookmarks, loadDownloads]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  // Reload downloads when switching to that tab
  useEffect(() => {
    if (activeTab === 'downloads') {
      loadDownloads();
    }
  }, [activeTab, loadDownloads]);

  const removeBookmark = useCallback(async (manga) => {
    try {
      await Storage.toggleBookmark(manga);
      setBookmarks((prev) => prev.filter((m) => m.url !== manga.url));
    } catch {
      Alert.alert('Error', 'Failed to remove bookmark.');
    }
  }, []);

  const deleteDownload = useCallback(
    async (entry) => {
      const meta = downloadsMeta[entry.id];
      const label = textOr(meta?.title, textOr(meta?.chapterName, 'this download'));
      Alert.alert(
        'Delete Download',
        `Remove ${label}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                // Use chapterUrl from metadata if available
                if (meta?.chapterUrl) {
                  await DownloadManager.deleteDownload(meta.chapterUrl);
                } else {
                  // Fallback: delete the directory directly
                  await FileSystem.deleteAsync(entry.path, {
                    idempotent: true,
                  });
                }
                await removeDownloadMeta(entry.id);
                setDownloads((prev) => prev.filter((d) => d.id !== entry.id));
              } catch (err) {
                Alert.alert('Error', 'Failed to delete download.');
              }
            },
          },
        ],
      );
    },
    [downloadsMeta],
  );

  const clearAllDownloads = useCallback(() => {
    if (downloads.length === 0) return;
    Alert.alert(
      'Clear All Downloads',
      `This will permanently remove all ${downloads.length} downloaded chapter(s). Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              const allMeta = await getDownloadsMeta();
              for (const entry of downloads) {
                try {
                  const meta = allMeta[entry.id];
                  if (meta?.chapterUrl) {
                    await DownloadManager.deleteDownload(meta.chapterUrl);
                  } else {
                    await FileSystem.deleteAsync(entry.path, { idempotent: true });
                  }
                } catch (_) {}
              }
              await saveDownloadsMeta({});
              setDownloads([]);
              setDownloadsMeta({});
            } catch (err) {
              Alert.alert('Error', 'Failed to clear all downloads.');
            }
          },
        },
      ]
    );
  }, [downloads]);

  const DownloadsListHeader = useCallback(() => {
    if (downloads.length === 0) return null;
    return (
      <TouchableOpacity
        style={styles.clearAllBtn}
        onPress={clearAllDownloads}
        activeOpacity={0.8}
      >
        <Ionicons name="trash-outline" size={16} color={THEME.danger} />
        <Text style={styles.clearAllText}>Clear All Downloads</Text>
      </TouchableOpacity>
    );
  }, [downloads.length, clearAllDownloads]);

  const renderBookmarkItem = useCallback(
    ({ item }) => (
      <View style={styles.bookmarkItemWrap}>
        <MangaCard
          item={item}
          onPress={() =>
            navigation.navigate('Details', {
              url: item.url,
              title: item.title,
              image: item.image,
              source: item.source,
            })
          }
        />
        <TouchableOpacity
          style={styles.removeBookmarkBtn}
          onPress={() => removeBookmark(item)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle" size={22} color={THEME.danger} />
        </TouchableOpacity>
      </View>
    ),
    [navigation, removeBookmark],
  );

  const renderDownloadItem = useCallback(
    ({ item }) => {
      const meta = downloadsMeta[item.id] || {};
      const title = textOr(meta.title, `Chapter ${item.id.slice(0, 8)}`);
      const chapterName = textOr(meta.chapterName);
      const source = textOr(meta.source);
      const imageUrl = textOr(meta.mangaImage);

      return (
        <TouchableOpacity
          style={styles.downloadCard}
          activeOpacity={0.85}
          onPress={() => {
            const chapterUrl = textOr(meta.chapterUrl);
            const readerTitle = chapterName || title;
            if (chapterUrl) {
              navigation.navigate('Reader', {
                url: chapterUrl,
                title: readerTitle,
                source,
                chapters: [{ url: chapterUrl, name: readerTitle }],
                currentIndex: 0,
                manga: {
                  url: textOr(meta.mangaUrl),
                  title,
                  image: imageUrl,
                  source,
                },
              });
              return;
            }
            const mangaUrl = textOr(meta.mangaUrl);
            if (mangaUrl) {
              navigation.navigate('Details', {
                url: mangaUrl,
                title,
                image: imageUrl,
                source,
              });
            }
          }}
        >
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.downloadThumb}
            />
          ) : (
            <View style={[styles.downloadThumb, styles.downloadThumbPlaceholder]}>
              <Ionicons name="image-outline" size={24} color={THEME.textMuted} />
            </View>
          )}
          <View style={styles.downloadInfo}>
            <Text style={styles.downloadTitle} numberOfLines={2}>
              {title}
            </Text>
            {chapterName ? (
              <Text style={styles.downloadChapter} numberOfLines={1}>
                {chapterName}
              </Text>
            ) : null}
            <View style={styles.downloadMetaRow}>
              {source ? (
                <Text style={styles.downloadSource}>{source}</Text>
              ) : null}
              <Text style={styles.downloadPages}>
                {item.count} page{item.count !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => deleteDownload(item)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={20} color={THEME.danger} />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [downloadsMeta, navigation, deleteDownload],
  );

  const keyExtractor = useCallback(
    (item, i) =>
      item.url
        ? `${item.url}-${i}`
        : `${item.id || 'unknown'}-${i}`,
    [],
  );

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'bookmarks' && styles.tabActive]}
        onPress={() => setActiveTab('bookmarks')}
        activeOpacity={0.8}
      >
        <Ionicons
          name={activeTab === 'bookmarks' ? 'bookmark' : 'bookmark-outline'}
          size={18}
          color={
            activeTab === 'bookmarks' ? THEME.primary : THEME.textSecondary
          }
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'bookmarks' && styles.tabLabelActive,
          ]}
        >
          Bookmarks
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'downloads' && styles.tabActive]}
        onPress={() => setActiveTab('downloads')}
        activeOpacity={0.8}
      >
        <Ionicons
          name={
            activeTab === 'downloads'
              ? 'cloud-download'
              : 'cloud-download-outline'
          }
          size={18}
          color={
            activeTab === 'downloads' ? THEME.primary : THEME.textSecondary
          }
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'downloads' && styles.tabLabelActive,
          ]}
        >
          Downloads
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader title="Library" subtitle="Your saved content" />
        {renderTabBar()}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Library" subtitle="Your saved content" />
      {renderTabBar()}
      {activeTab === 'bookmarks' ? (
        <FlatList
          key="bookmarks"
          data={bookmarks}
          keyExtractor={keyExtractor}
          numColumns={2}
          contentContainerStyle={[
            styles.list,
            bookmarks.length === 0 && styles.listFlex,
          ]}
          columnWrapperStyle={styles.row}
          renderItem={renderBookmarkItem}
          ListEmptyComponent={
            <EmptyState
              icon="bookmarks-outline"
              title="No bookmarks yet"
              subtitle="Tap the bookmark icon on any manga to save it here."
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={THEME.primary}
              colors={[THEME.primary]}
            />
          }
        />
      ) : (
        <FlatList
          key="downloads"
          data={downloads}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.downloadsList,
            downloads.length === 0 && styles.listFlex,
          ]}
          renderItem={renderDownloadItem}
          ListHeaderComponent={DownloadsListHeader}
          ListEmptyComponent={
            <EmptyState
              icon="cloud-download-outline"
              title="No downloads yet"
              subtitle="Download chapters from any series to read offline."
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={THEME.primary}
              colors={[THEME.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: THEME.space.xl,
  },
  list: {
    padding: THEME.space.sm,
    paddingBottom: THEME.space.xl * 6,
  },
  listFlex: {
    flexGrow: 1,
  },
  row: {
    justifyContent: 'space-between',
  },
  // Tab bar
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: THEME.space.lg,
    marginBottom: THEME.space.md,
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: THEME.space.sm + 2,
    borderRadius: THEME.radius.sm,
    gap: 6,
  },
  tabActive: {
    backgroundColor: THEME.primaryDark,
  },
  tabLabel: {
    color: THEME.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: THEME.text,
  },
  // Bookmark items
  bookmarkItemWrap: {
    position: 'relative',
    marginBottom: THEME.space.md,
  },
  removeBookmarkBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    backgroundColor: 'rgba(11,17,32,0.7)',
    borderRadius: THEME.radius.pill,
  },
  // Download items
  downloadsList: {
    paddingHorizontal: THEME.space.lg,
    paddingBottom: THEME.space.xl * 6,
  },
  downloadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: THEME.space.md,
    padding: THEME.space.md,
  },
  downloadThumb: {
    width: 48,
    height: 64,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surface,
    marginRight: THEME.space.md,
  },
  downloadThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadInfo: {
    flex: 1,
    marginRight: THEME.space.sm,
  },
  downloadTitle: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  downloadChapter: {
    color: THEME.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  downloadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: THEME.space.xs,
    gap: THEME.space.sm,
  },
  downloadSource: {
    color: THEME.primary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  downloadPages: {
    color: THEME.textMuted,
    fontSize: 12,
  },
  deleteBtn: {
    padding: THEME.space.sm,
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.danger,
    paddingVertical: THEME.space.md,
    marginBottom: THEME.space.md,
    gap: THEME.space.sm,
  },
  clearAllText: {
    color: THEME.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
