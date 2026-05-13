import React, { useState, useEffect, useCallback } from 'react';
import { NavigationContainer, DefaultTheme, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  TextInput,
  Alert,
  Pressable,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { Scraper, SOURCE_ORDER, sourceShortLabel, HEADERS } from './scrapers';
import { debugLog } from './debugLog';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const { width } = Dimensions.get('window');

const THEME = {
  bg: '#0B1120',
  surface: '#121A2B',
  surfaceElevated: '#1A2438',
  border: '#2A3754',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  danger: '#F87171',
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 },
};

const navigationTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: THEME.primary,
    background: THEME.bg,
    card: THEME.surfaceElevated,
    text: THEME.text,
    border: THEME.border,
    notification: THEME.primary,
  },
};

const DownloadManager = {
  async getLocalUri(chapterUrl) {
    const id = btoa(chapterUrl).substring(0, 20);
    const dir = `${FileSystem.documentDirectory}downloads/${id}/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return null;
    const files = await FileSystem.readDirectoryAsync(dir);
    return files.sort().map((f) => `${dir}${f}`);
  },

  async downloadChapter(source, chapterUrl, onProgress) {
    const id = btoa(chapterUrl).substring(0, 20);
    const dir = `${FileSystem.documentDirectory}downloads/${id}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const images = await Scraper.fetchImages(source, chapterUrl);
    const dlHeaders = {
      ...HEADERS,
      ...(chapterUrl && String(chapterUrl).startsWith('http') ? { Referer: chapterUrl } : {}),
    };
    for (let i = 0; i < images.length; i++) {
      const fileUri = `${dir}${String(i).padStart(3, '0')}.jpg`;
      await FileSystem.downloadAsync(images[i], fileUri, { headers: dlHeaders });
      if (onProgress) onProgress((i + 1) / images.length);
    }
    return true;
  },
};

const Storage = {
  async getBookmarks() {
    const val = await AsyncStorage.getItem('@bookmarks');
    return val ? JSON.parse(val) : [];
  },
  async isBookmarked(url) {
    const list = await this.getBookmarks();
    return list.some((m) => m.url === url);
  },
  async toggleBookmark(manga) {
    let list = await this.getBookmarks();
    const exists = list.find((m) => m.url === manga.url);
    if (exists) list = list.filter((m) => m.url !== manga.url);
    else list.push(manga);
    await AsyncStorage.setItem('@bookmarks', JSON.stringify(list));
    return !exists;
  },
  async addHistory(manga, chapterName, chapterUrl) {
    let list = JSON.parse((await AsyncStorage.getItem('@history')) || '[]');
    list = list.filter((m) => m.url !== manga.url);
    list.unshift({
      ...manga,
      lastChapter: chapterName,
      lastChapterUrl: chapterUrl,
      timestamp: Date.now(),
    });
    await AsyncStorage.setItem('@history', JSON.stringify(list.slice(0, 50)));
  },
  async getHistory() {
    const val = await AsyncStorage.getItem('@history');
    return val ? JSON.parse(val) : [];
  },
};

function AutoHeightImage({ source, referer }) {
  const [height, setHeight] = useState(300);
  useEffect(() => {
    if (source.startsWith('file://')) {
      Image.getSize(source, (w, h) => setHeight(h * (width / w)), () => setHeight(400));
    } else {
      const headers = referer && referer.startsWith('http') ? { Referer: referer } : undefined;
      Image.getSizeWithHeaders(
        source,
        headers || {},
        (w, h) => setHeight(h * (width / w)),
        () => setHeight(400)
      );
    }
  }, [source, referer]);
  const headers = referer && referer.startsWith('http') ? { Referer: referer } : undefined;
  return <Image source={{ uri: source, headers }} style={{ width, height, resizeMode: 'cover' }} />;
}

function SourceSegment({ value, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sourceBarScroll}
      nestedScrollEnabled
    >
      {SOURCE_ORDER.map((s) => {
        const active = value === s;
        const label = sourceShortLabel(s);
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={({ pressed }) => [
              styles.sourceChip,
              active && styles.sourceChipActive,
              pressed && !active && styles.sourceChipPressed,
            ]}
          >
            <Text style={[styles.sourceChipText, active && styles.sourceChipTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name={icon} size={48} color={THEME.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function ScreenHeader({ title, subtitle }) {
  return (
    <View style={styles.screenHeader}>
      <Text style={styles.screenHeaderTitle}>{title}</Text>
      {subtitle ? <Text style={styles.screenHeaderSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function HomeScreen({ navigation }) {
  const [manga, setManga] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState('Komikindo');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Scraper.fetchLatest(source)
      .then((data) => {
        setManga(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(`Error: ${err?.message || err}`);
        setManga([]);
        setLoading(false);
      });
  }, [source]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    Scraper.fetchLatest(source)
      .then((data) => {
        setManga(data);
      })
      .catch((err) => {
        setError(`Error: ${err?.message || err}`);
        setManga([]);
      })
      .finally(() => {
        setRefreshing(false);
        setLoading(false);
      });
  }, [source]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Discover" subtitle="Latest series from your selected source" />
      <SourceSegment value={source} onChange={setSource} />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={styles.loadingHint}>Loading catalog…</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={THEME.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={load} activeOpacity={0.85}>
            <Text style={styles.primaryButtonLabel}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={manga}
          keyExtractor={(item, i) => `${item.url}-${i}`}
          numColumns={2}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={THEME.primary}
              colors={[THEME.primary]}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('Details', { ...item })}
            >
              <View style={styles.cardImageWrap}>
                <Image
                  source={{
                    uri: item.image,
                    headers: item.url && String(item.url).startsWith('http') ? { Referer: item.url } : undefined,
                  }}
                  style={styles.image}
                />
                <View style={styles.sourceBadge}>
                  <Text style={styles.sourceBadgeText}>
                    {sourceShortLabel(item.source)}
                  </Text>
                </View>
              </View>
              <View style={styles.info}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="albums-outline"
              title="Nothing here yet"
              subtitle="Try another source or pull down to refresh."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [manga, setManga] = useState([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState('Komikindo');

  const search = () => {
    if (!query.trim()) return;
    setLoading(true);
    Scraper.fetchSearch(source, query.trim())
      .then((data) => {
        setManga(data);
        setLoading(false);
      })
      .catch(() => {
        setManga([]);
        setLoading(false);
        Alert.alert('Search failed', 'Please check your connection and try again.');
      });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Search" subtitle="Find titles across your source" />
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={THEME.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Title or keyword…"
          placeholderTextColor={THEME.textMuted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          returnKeyType="search"
        />
        <TouchableOpacity onPress={search} style={styles.searchGo} activeOpacity={0.8}>
          <Text style={styles.searchGoText}>Go</Text>
        </TouchableOpacity>
      </View>
      <SourceSegment value={source} onChange={setSource} />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
        </View>
      ) : (
        <FlatList
          data={manga}
          keyExtractor={(item, i) => `${item.url}-${i}`}
          numColumns={2}
          contentContainerStyle={[styles.list, manga.length === 0 && styles.listFlex]}
          columnWrapperStyle={styles.row}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('Details', { ...item })}
            >
              <View style={styles.cardImageWrap}>
                <Image
                  source={{
                    uri: item.image,
                    headers: item.url && String(item.url).startsWith('http') ? { Referer: item.url } : undefined,
                  }}
                  style={styles.image}
                />
                <View style={styles.sourceBadge}>
                  <Text style={styles.sourceBadgeText}>
                    {sourceShortLabel(item.source)}
                  </Text>
                </View>
              </View>
              <View style={styles.info}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            query.trim() ? (
              <EmptyState
                icon="search-outline"
                title="No matches"
                subtitle="Try a different keyword or switch source."
              />
            ) : (
              <EmptyState
                icon="book-outline"
                title="Start typing"
                subtitle="Search by title or keyword, then tap Go."
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

function LibraryScreen({ navigation }) {
  const [manga, setManga] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => {
    setRefreshing(true);
    Storage.getBookmarks()
      .then(setManga)
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      Storage.getBookmarks().then(setManga);
    }, [])
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Library" subtitle="Saved bookmarks" />
      <FlatList
        data={manga}
        keyExtractor={(item, i) => `${item.url}-${i}`}
        numColumns={2}
        contentContainerStyle={[styles.list, manga.length === 0 && styles.listFlex]}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={THEME.primary}
            colors={[THEME.primary]}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Details', { ...item })}
          >
            <View style={styles.cardImageWrap}>
              <Image
                source={{
                  uri: item.image,
                  headers: item.url && String(item.url).startsWith('http') ? { Referer: item.url } : undefined,
                }}
                style={styles.image}
              />
            </View>
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="bookmark-outline"
            title="Your library is empty"
            subtitle="Open a series and tap Save to library to add it here."
          />
        }
      />
    </SafeAreaView>
  );
}

function HistoryScreen({ navigation }) {
  const [items, setItems] = useState([]);

  useFocusEffect(
    useCallback(() => {
      Storage.getHistory().then(setItems);
    }, [])
  );

  const formatTime = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader title="History" subtitle="Recently opened chapters" />
      <FlatList
        data={items}
        keyExtractor={(item, i) => `${item.url}-${item.timestamp}-${i}`}
        contentContainerStyle={[styles.historyList, items.length === 0 && styles.listFlex]}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.historyRow}
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate('Details', {
                url: item.url,
                title: item.title,
                image: item.image,
                source: item.source,
              })
            }
          >
            <Image
              source={{
                uri: item.image,
                headers: item.url && String(item.url).startsWith('http') ? { Referer: item.url } : undefined,
              }}
              style={styles.historyThumb}
            />
            <View style={styles.historyMeta}>
              <Text style={styles.historyTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.historyChapter} numberOfLines={1}>
                {item.lastChapter}
              </Text>
              <Text style={styles.historyDate}>{formatTime(item.timestamp)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={THEME.textMuted} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="time-outline"
            title="No reading history"
            subtitle="Chapters you open will appear here for quick return."
          />
        }
      />
    </SafeAreaView>
  );
}

function DetailsScreen({ route, navigation }) {
  const { url, title, image, source } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    Storage.isBookmarked(url).then(setBookmarked);
  }, [url]);

  useEffect(() => {
    const t = (data?.title || title || 'Details').trim();
    navigation.setOptions({ title: t.length > 28 ? `${t.slice(0, 28)}…` : t });
  }, [data?.title, title, navigation]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Scraper.fetchDetails(source, url)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoading(false);
          Alert.alert('Could not load', 'Failed to load series details.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, url]);

  const startDownload = async (ch) => {
    try {
      setDownloading(ch.url);
      await DownloadManager.downloadChapter(source, ch.url, () => { });
      Alert.alert('Downloaded', 'Chapter saved for offline reading.');
    } catch {
      Alert.alert('Download failed', 'Please try again when online.');
    } finally {
      setDownloading(null);
    }
  };

  const onToggleBookmark = async () => {
    const added = await Storage.toggleBookmark({ url, title, image, source });
    setBookmarked(added);
    Alert.alert('Library', added ? 'Saved to your library.' : 'Removed from library.');
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={THEME.primary} />
        <Text style={styles.loadingHint}>Loading series…</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.container, styles.centered]}>
        <EmptyState icon="alert-circle-outline" title="Nothing to show" subtitle="Go back and try again." />
      </View>
    );
  }

  const chapterCount = data.chapters?.length ?? 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.detailHero}>
        <Image
          source={{
            uri: data.image || image,
            headers: url && String(url).startsWith('http') ? { Referer: url } : undefined,
          }}
          style={styles.detailCover}
        />
        <View style={styles.detailHeroGradient} />
      </View>
      <View style={styles.detailInfo}>
        <Text style={styles.detailTitle}>{data.title || title}</Text>
        <Text style={styles.detailMeta}>
          {source} · {chapterCount} chapters
        </Text>
        <TouchableOpacity
          onPress={onToggleBookmark}
          style={[styles.bookmarkButton, bookmarked && styles.bookmarkButtonActive]}
          activeOpacity={0.88}
        >
          <Ionicons
            name={bookmarked ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={THEME.text}
            style={{ marginRight: THEME.space.sm }}
          />
          <Text style={styles.bookmarkButtonLabel}>{bookmarked ? 'Saved to library' : 'Save to library'}</Text>
        </TouchableOpacity>
        {data.description ? (
          <Pressable onPress={() => setDescExpanded(!descExpanded)}>
            <Text style={styles.detailDesc} numberOfLines={descExpanded ? undefined : 4}>
              {data.description}
            </Text>
            <Text style={styles.readMore}>{descExpanded ? 'Show less' : 'Read more'}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.chapterHeader}>
        <Text style={styles.chapterHeaderText}>Chapters</Text>
        <Text style={styles.chapterHeaderCount}>{chapterCount}</Text>
      </View>
      {data.chapters?.map((ch, idx) => (
        <View key={`${ch.url}-${idx}`} style={styles.chapterItem}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={0.85}
            onPress={() => {
              Storage.addHistory({ url, title, image, source }, ch.name, ch.url);
              navigation.navigate('Reader', {
                url: ch.url,
                title: ch.name,
                source,
                chapters: data.chapters,
                currentIndex: idx,
              });
            }}
          >
            <Text style={styles.chapterName}>{ch.name}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => startDownload(ch)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={downloading === ch.url}
          >
            <Ionicons
              name={downloading === ch.url ? 'hourglass-outline' : 'download-outline'}
              size={22}
              color={THEME.primary}
            />
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

function ReaderScreen({ route, navigation }) {
  const { url, title, source, chapters, currentIndex } = route.params;
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('webtoon');
  const [errorMessage, setErrorMessage] = useState('');

  const loadImages = async (targetUrl, retryCount = 0) => {
    // #region agent log
    debugLog(
      'App.js:ReaderScreen.loadImages',
      'start',
      {
        source,
        title,
        targetUrlPreview: String(targetUrl).slice(0, 120),
        currentIndex,
        retryCount,
      },
      'H3'
    );
    // #endregion
    setLoading(true);
    setErrorMessage('');
    try {
      const local = await DownloadManager.getLocalUri(targetUrl);
      // #region agent log
      debugLog(
        'App.js:ReaderScreen.loadImages',
        'after_local',
        { localIsArray: Array.isArray(local), localLen: local?.length ?? (local ? 1 : 0) },
        'H4'
      );
      // #endregion
      if (local) {
        setImages(local);
      } else {
        const remote = await Scraper.fetchImages(source, targetUrl);
        // #region agent log
        debugLog(
          'App.js:ReaderScreen.loadImages',
          'after_remote',
          { remoteLen: (remote || []).length },
          'H1'
        );
        // #endregion
        if (!remote || remote.length === 0) {
          throw new Error('No images returned from source');
        }
        setImages(remote || []);
      }
    } catch (error) {
      console.error(error);
      const errMsg = String(error?.message || error).slice(0, 220);
      // #region agent log
      debugLog(
        'App.js:ReaderScreen.loadImages',
        'catch',
        { err: errMsg, name: error?.name, retryCount },
        'H2'
      );
      // #endregion

      // Auto-retry once after a short delay
      if (retryCount < 1) {
        debugLog('App.js:ReaderScreen.loadImages', 'auto_retry', {}, 'H4');
        setTimeout(() => {
          loadImages(targetUrl, retryCount + 1);
        }, 1500);
        return; // Don't set loading false yet
      }

      setImages([]);
      setErrorMessage(errMsg);

      // Show a more helpful error message
      let userMessage = 'Could not load this chapter.';
      if (errMsg.includes('All') && errMsg.includes('domains failed')) {
        userMessage = `Source "${source}" is currently unreachable. Try another source or check your internet connection.`;
      } else if (errMsg.includes('No images')) {
        userMessage = `No images found for this chapter on "${source}". The site may have changed its layout.`;
      } else if (errMsg.includes('timeout') || errMsg.includes('abort')) {
        userMessage = 'Request timed out. Check your internet connection and try again.';
      } else if (errMsg.includes('fetch') || errMsg.includes('Network')) {
        userMessage = 'Network error. Make sure you have an active internet connection.';
      } else if (errMsg.includes('script missing')) {
        userMessage = `Bato.to anti-scraping protection blocked this chapter. Try MangaDex instead.`;
      }
      Alert.alert('Error', userMessage);
    }
    setLoading(false);
  };


  useEffect(() => {
    loadImages(url);
  }, [url]);

  const nextChapter = () => {
    if (currentIndex > 0) {
      const next = chapters[currentIndex - 1];
      navigation.setParams({ url: next.url, title: next.name, currentIndex: currentIndex - 1 });
    }
  };

  if (loading) {
    return (
      <View style={[styles.readerRoot, styles.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={THEME.primary} />
        <Text style={styles.loadingHintDark}>Loading pages…</Text>
      </View>
    );
  }

  const headerPadTop = Math.max(insets.top, THEME.space.md);

  return (
    <View style={styles.readerRoot}>
      <StatusBar style="light" />
      <View style={[styles.readerHeader, { paddingTop: headerPadTop }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.readerTitle} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity
          onPress={() => setMode(mode === 'webtoon' ? 'manga' : 'webtoon')}
          hitSlop={12}
          accessibilityLabel={mode === 'webtoon' ? 'Switch to page mode' : 'Switch to scroll mode'}
        >
          <Ionicons
            name={mode === 'webtoon' ? 'book-outline' : 'phone-portrait-outline'}
            size={24}
            color={THEME.text}
          />
        </TouchableOpacity>
      </View>
      {images.length === 0 ? (
        <View style={styles.readerEmpty}>
          <Ionicons name="image-outline" size={48} color={THEME.textMuted} />
          <Text style={styles.readerEmptyText}>No pages loaded</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => loadImages(url)} activeOpacity={0.85}>
            <Text style={styles.primaryButtonLabel}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={images}
          keyExtractor={(_, i) => i.toString()}
          horizontal={mode === 'manga'}
          pagingEnabled={mode === 'manga'}
          onEndReached={mode === 'webtoon' ? nextChapter : undefined}
          onEndReachedThreshold={0.5}
          contentContainerStyle={mode === 'webtoon' ? { paddingBottom: insets.bottom + THEME.space.lg } : undefined}
          renderItem={({ item }) => <AutoHeightImage source={item} referer={url} />}
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: THEME.surfaceElevated },
            headerTintColor: THEME.text,
            headerTitleStyle: { fontWeight: '600', fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: THEME.bg },
          }}
        >
          <Stack.Screen name="Main" options={{ headerShown: false }}>
            {() => (
              <Tab.Navigator
                screenOptions={{
                  headerShown: false,
                  tabBarStyle: {
                    backgroundColor: THEME.surface,
                    borderTopColor: THEME.border,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                  tabBarActiveTintColor: THEME.primary,
                  tabBarInactiveTintColor: THEME.textMuted,
                  tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
                }}
              >
                <Tab.Screen
                  name="Home"
                  component={HomeScreen}
                  options={{
                    tabBarLabel: 'Home',
                    tabBarIcon: ({ color, focused }) => (
                      <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
                    ),
                  }}
                />
                <Tab.Screen
                  name="Search"
                  component={SearchScreen}
                  options={{
                    tabBarLabel: 'Search',
                    tabBarIcon: ({ color, focused }) => (
                      <Ionicons name={focused ? 'search' : 'search-outline'} size={22} color={color} />
                    ),
                  }}
                />
                <Tab.Screen
                  name="Library"
                  component={LibraryScreen}
                  options={{
                    tabBarLabel: 'Library',
                    tabBarIcon: ({ color, focused }) => (
                      <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={22} color={color} />
                    ),
                  }}
                />
                <Tab.Screen
                  name="History"
                  component={HistoryScreen}
                  options={{
                    tabBarLabel: 'History',
                    tabBarIcon: ({ color, focused }) => (
                      <Ionicons name={focused ? 'time' : 'time-outline'} size={22} color={color} />
                    ),
                  }}
                />
              </Tab.Navigator>
            )}
          </Stack.Screen>
          <Stack.Screen name="Details" component={DetailsScreen} options={{ title: 'Details' }} />
          <Stack.Screen name="Reader" component={ReaderScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: THEME.space.xl },
  list: { padding: THEME.space.sm, paddingBottom: THEME.space.xl * 2 },
  listFlex: { flexGrow: 1 },
  row: { justifyContent: 'space-between' },
  screenHeader: {
    paddingHorizontal: THEME.space.lg,
    paddingTop: THEME.space.sm,
    paddingBottom: THEME.space.md,
  },
  screenHeaderTitle: {
    color: THEME.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  screenHeaderSubtitle: {
    color: THEME.textSecondary,
    fontSize: 14,
    marginTop: THEME.space.xs,
  },
  sourceBarScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: THEME.space.lg,
    paddingBottom: THEME.space.md,
    flexGrow: 0,
  },
  sourceChip: {
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.lg,
    borderRadius: THEME.radius.pill,
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
    marginRight: THEME.space.sm,
  },
  sourceChipPressed: { opacity: 0.85 },
  sourceChipActive: {
    backgroundColor: THEME.primaryDark,
    borderColor: THEME.primary,
  },
  sourceChipText: { color: THEME.textSecondary, fontSize: 13, fontWeight: '600' },
  sourceChipTextActive: { color: THEME.text },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: THEME.space.lg,
    marginBottom: THEME.space.md,
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.lg,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingLeft: THEME.space.md,
  },
  searchIcon: { marginRight: THEME.space.sm },
  searchInput: {
    flex: 1,
    color: THEME.text,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 16,
  },
  searchGo: {
    paddingHorizontal: THEME.space.lg,
    paddingVertical: THEME.space.md,
    backgroundColor: THEME.primaryDark,
    borderTopRightRadius: THEME.radius.lg - 1,
    borderBottomRightRadius: THEME.radius.lg - 1,
  },
  searchGoText: { color: THEME.text, fontWeight: '700', fontSize: 15 },
  card: {
    width: (width - THEME.space.md * 3) / 2,
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    overflow: 'hidden',
    marginBottom: THEME.space.md,
    borderWidth: 1,
    borderColor: THEME.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  cardImageWrap: { position: 'relative' },
  image: { width: '100%', aspectRatio: 0.7, backgroundColor: THEME.surface },
  sourceBadge: {
    position: 'absolute',
    bottom: THEME.space.sm,
    left: THEME.space.sm,
    backgroundColor: 'rgba(11,17,32,0.85)',
    paddingHorizontal: THEME.space.sm,
    paddingVertical: 4,
    borderRadius: THEME.radius.sm,
  },
  sourceBadgeText: { color: THEME.text, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  info: { padding: THEME.space.md },
  title: { color: THEME.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  loadingHint: { color: THEME.textSecondary, marginTop: THEME.space.md, fontSize: 14 },
  loadingHintDark: { color: THEME.textSecondary, marginTop: THEME.space.md, fontSize: 14 },
  errorText: {
    color: THEME.textSecondary,
    textAlign: 'center',
    marginTop: THEME.space.md,
    marginBottom: THEME.space.lg,
    lineHeight: 22,
    paddingHorizontal: THEME.space.lg,
  },
  primaryButton: {
    backgroundColor: THEME.primaryDark,
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.xl * 2,
    borderRadius: THEME.radius.md,
  },
  primaryButtonLabel: { color: THEME.text, fontWeight: '700', fontSize: 15 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: THEME.space.xl * 3,
    paddingHorizontal: THEME.space.xl,
  },
  emptyTitle: {
    color: THEME.text,
    fontSize: 17,
    fontWeight: '600',
    marginTop: THEME.space.lg,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: THEME.textSecondary,
    fontSize: 14,
    marginTop: THEME.space.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  detailScroll: { paddingBottom: THEME.space.xl * 2 },
  detailHero: { position: 'relative' },
  detailCover: { width: '100%', height: 280, backgroundColor: THEME.surface },
  detailHeroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 100,
    backgroundColor: 'rgba(11,17,32,0.5)',
  },
  detailInfo: { padding: THEME.space.lg, paddingTop: THEME.space.md },
  detailTitle: { color: THEME.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  detailMeta: { color: THEME.textMuted, fontSize: 14, marginTop: THEME.space.sm },
  bookmarkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.surfaceElevated,
    paddingVertical: THEME.space.md,
    borderRadius: THEME.radius.md,
    marginTop: THEME.space.lg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  bookmarkButtonActive: {
    backgroundColor: THEME.primaryDark,
    borderColor: THEME.primary,
  },
  bookmarkButtonLabel: { color: THEME.text, fontWeight: '700', fontSize: 15 },
  detailDesc: { color: THEME.textSecondary, fontSize: 15, marginTop: THEME.space.lg, lineHeight: 22 },
  readMore: { color: THEME.primary, fontWeight: '600', marginTop: THEME.space.sm, fontSize: 14 },
  chapterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.surface,
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: THEME.border,
  },
  chapterHeaderText: { color: THEME.text, fontWeight: '700', fontSize: 15 },
  chapterHeaderCount: { color: THEME.textMuted, fontSize: 13, fontWeight: '600' },
  chapterItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.bg,
  },
  chapterName: { color: THEME.text, fontSize: 15 },
  readerRoot: { flex: 1, backgroundColor: '#000' },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.space.md,
    paddingBottom: THEME.space.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  readerTitle: {
    flex: 1,
    color: THEME.text,
    fontWeight: '600',
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: THEME.space.sm,
  },
  readerEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: THEME.space.xl },
  readerEmptyText: { color: THEME.textSecondary, marginTop: THEME.space.md, marginBottom: THEME.space.lg },
  historyList: { paddingHorizontal: THEME.space.lg, paddingBottom: THEME.space.xl },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    padding: THEME.space.md,
    marginBottom: THEME.space.md,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  historyThumb: {
    width: 52,
    height: 72,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surface,
  },
  historyMeta: { flex: 1, marginLeft: THEME.space.md },
  historyTitle: { color: THEME.text, fontSize: 15, fontWeight: '600' },
  historyChapter: { color: THEME.textSecondary, fontSize: 13, marginTop: 4 },
  historyDate: { color: THEME.textMuted, fontSize: 12, marginTop: 4 },
});
