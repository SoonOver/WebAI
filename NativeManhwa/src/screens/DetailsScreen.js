import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  TextInput,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Scraper } from '../../scrapers';
import { THEME } from '../theme';
import { Storage, DownloadManager, downloadIdsForUrl } from '../storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenHeader, EmptyState, ProtectedImage } from '../components/UIComponents';

function chapterSortNumber(chapter) {
  const name = String(chapter?.name || '');
  const match =
    name.match(/(?:ch(?:apter)?\.?\s*)(\d+(?:\.\d+)?)/i) ||
    name.match(/(\d+(?:\.\d+)?)/);
  const parsed = Number.parseFloat(match?.[1] || '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareChapters(a, b, order) {
  const diff = chapterSortNumber(b) - chapterSortNumber(a);
  if (diff !== 0) return order === 'desc' ? diff : -diff;
  const fallback = (a._sourceIndex || 0) - (b._sourceIndex || 0);
  return order === 'desc' ? fallback : -fallback;
}

export default function DetailsScreen({ route, navigation }) {
  const params = route?.params || {};
  const url = typeof params.url === 'string' ? params.url : '';
  const routeTitle = typeof params.title === 'string' && params.title.trim()
    ? params.title.trim()
    : 'Untitled';
  const routeImage = typeof params.image === 'string' ? params.image : '';
  const source = typeof params.source === 'string' ? params.source : '';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [downloadedChapters, setDownloadedChapters] = useState(new Set());
  const [descExpanded, setDescExpanded] = useState(false);
  const [lastHistory, setLastHistory] = useState(null);
  const [chapterQuery, setChapterQuery] = useState('');
  const [chapterOrder, setChapterOrder] = useState('desc');

  // Load bookmark status
  useEffect(() => {
    let cancelled = false;
    setBookmarked(false);
    (async () => {
      try {
        if (!url) return;
        const isBm = await Storage.isBookmarked(url);
        if (!cancelled) setBookmarked(isBm);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Fetch series details
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setDownloadedChapters(new Set());
    setDescExpanded(false);
    setChapterQuery('');

    const loadDetails = async () => {
      try {
        if (!url || !source) {
          if (!cancelled) {
            setData({
              title: routeTitle,
              image: routeImage,
              description: '',
              chapters: [],
            });
          }
          return;
        }
        const result = await Scraper.fetchDetails(source, url);
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          Alert.alert('Error', `Failed to load details: ${err?.message || err}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadDetails();

    return () => {
      cancelled = true;
    };
  }, [source, url, routeTitle, routeImage]);

  const { title, image, description, chapters } = data || {};
  const chapterList = useMemo(
    () =>
      Array.isArray(chapters)
        ? chapters
          .filter((ch) => ch && typeof ch === 'object')
          .map((ch, index) => ({
            ...ch,
            _sourceIndex: index,
            url: typeof ch.url === 'string' ? ch.url : '',
            name: typeof ch.name === 'string' && ch.name.trim()
              ? ch.name.trim()
              : `Chapter ${index + 1}`,
          }))
        : [],
    [chapters],
  );
  const displayTitle = typeof title === 'string' && title.trim()
    ? title.trim()
    : routeTitle;
  const displayImage = typeof image === 'string' && image.trim()
    ? image.trim()
    : routeImage;
  const displayDescription = typeof description === 'string' ? description : '';
  const chapterCount = chapterList.length;
  const displaySource = source || 'Unknown';
  const downloadsAvailable = Platform.OS !== 'web';
  const orderedChapterList = useMemo(
    () => [...chapterList].sort((a, b) => compareChapters(a, b, chapterOrder)),
    [chapterList, chapterOrder],
  );
  const readingChapterList = useMemo(
    () => [...chapterList].sort((a, b) => compareChapters(a, b, 'asc')),
    [chapterList],
  );
  const visibleChapterList = useMemo(() => {
    const query = chapterQuery.trim().toLowerCase();
    if (!query) return orderedChapterList;
    return orderedChapterList.filter((ch) =>
      String(ch?.name || '').toLowerCase().includes(query)
    );
  }, [orderedChapterList, chapterQuery]);
  const visibleChapterCount = visibleChapterList.length;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          if (!url) {
            if (active) setLastHistory(null);
            return;
          }
          const history = await Storage.getHistory();
          const entry = history.find((item) => item.url === url) || null;
          if (active) setLastHistory(entry);
        } catch (_) {
          if (active) setLastHistory(null);
        }
      })();
      return () => {
        active = false;
      };
    }, [url]),
  );

  // Recheck downloaded chapters when data changes
  useEffect(() => {
    let cancelled = false;

    const checkDownloads = async () => {
      const chapters = chapterList.filter((ch) => ch.url);
      if (chapters.length === 0) {
        if (!cancelled) setDownloadedChapters(new Set());
        return;
      }
      try {
        const results = await Promise.allSettled(
          chapters.map((ch) => DownloadManager.isDownloaded(ch.url))
        );
        const downloaded = new Set();
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value && chapters[i]?.url) {
            downloaded.add(chapters[i].url);
          }
        });
        if (!cancelled) setDownloadedChapters(downloaded);
      } catch (_) {}
    };

    checkDownloads();

    return () => {
      cancelled = true;
    };
  }, [chapterList]);

  const handleBookmarkToggle = useCallback(async () => {
    try {
      if (!url) {
        Alert.alert('Error', 'This title does not have a valid URL.');
        return;
      }
      const mangaInfo = {
        url,
        title: displayTitle,
        image: displayImage,
        source,
      };
      const isNowBookmarked = await Storage.toggleBookmark(mangaInfo);
      setBookmarked(isNowBookmarked);
    } catch (err) {
      Alert.alert('Error', 'Failed to toggle bookmark.');
    }
  }, [url, displayTitle, displayImage, source]);

  const handleDownload = useCallback(async (chapterUrl, chapterName) => {
    if (!downloadsAvailable) {
      Alert.alert('Download Unavailable', 'Offline chapter downloads are available in the mobile app.');
      return;
    }
    if (!chapterUrl || !source) {
      Alert.alert('Download Failed', 'This chapter cannot be downloaded because its source is missing.');
      return;
    }
    if (downloading && downloading !== chapterUrl) return;
    if (downloadedChapters.has(chapterUrl)) {
      // Already downloaded — show option to delete
      Alert.alert('Remove Download', `Delete "${chapterName}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await DownloadManager.deleteDownload(chapterUrl);
              // Remove metadata
              try {
                const metaKey = '@downloads_meta';
                const existing = JSON.parse((await AsyncStorage.getItem(metaKey)) || '{}');
                downloadIdsForUrl(chapterUrl).forEach((id) => {
                  delete existing[id];
                });
                await AsyncStorage.setItem(metaKey, JSON.stringify(existing));
              } catch (_) {}
              setDownloadedChapters((prev) => {
                const next = new Set(prev);
                next.delete(chapterUrl);
                return next;
              });
            } catch (err) {
              Alert.alert('Error', 'Failed to delete download.');
            }
          },
        },
      ]);
      return;
    }

    setDownloading(chapterUrl);
    try {
      const result = await DownloadManager.downloadChapter(source, chapterUrl);
      if (result.status === 'downloaded' || result.status === 'already_downloaded') {
        setDownloadedChapters((prev) => new Set(prev).add(chapterUrl));
        // Save download metadata for offline library
        try {
          const metaKey = '@downloads_meta';
          const existing = JSON.parse((await AsyncStorage.getItem(metaKey)) || '{}');
          const id = result.id || downloadIdsForUrl(chapterUrl)[0];
          existing[id] = {
            title: displayTitle,
            source: source,
            chapterUrl: chapterUrl,
            chapterName: chapterName,
            mangaUrl: url,
            mangaImage: displayImage,
            downloadedAt: Date.now(),
          };
          await AsyncStorage.setItem(metaKey, JSON.stringify(existing));
        } catch (_) {}
      }
    } catch (err) {
      Alert.alert('Download Failed', err?.message || 'Unknown error');
    } finally {
      setDownloading(null);
    }
  }, [downloadsAvailable, source, displayTitle, url, displayImage, downloadedChapters, downloading]);

  const handleChapterPress = useCallback(async (ch) => {
    if (!ch?.url) {
      Alert.alert('Error', 'This chapter does not have a valid URL.');
      return;
    }
    // Save to history
    try {
      await Storage.addHistory(
        { url, title: displayTitle, image: displayImage, source },
        ch.name,
        ch.url
      );
    } catch (_) {}

    const readerIndex = readingChapterList.findIndex((item) => item.url === ch.url);
    navigation.navigate('Reader', {
      url: ch.url,
      title: ch.name,
      source,
      chapters: readingChapterList,
      currentIndex: readerIndex >= 0 ? readerIndex : 0,
      manga: { url, title: displayTitle, image: displayImage, source },
    });
  }, [url, displayTitle, displayImage, source, readingChapterList, navigation]);

  const handlePrimaryRead = useCallback(() => {
    const historyUrl = typeof lastHistory?.lastChapterUrl === 'string'
      ? lastHistory.lastChapterUrl
      : '';
    if (historyUrl) {
      const historyIndex = readingChapterList.findIndex((ch) => ch.url === historyUrl);
      if (historyIndex >= 0) {
        handleChapterPress(readingChapterList[historyIndex]);
        return;
      }
      const historyName = typeof lastHistory?.lastChapter === 'string' && lastHistory.lastChapter.trim()
        ? lastHistory.lastChapter.trim()
        : displayTitle;
      navigation.navigate('Reader', {
        url: historyUrl,
        title: historyName,
        source,
        chapters: [{ url: historyUrl, name: historyName }],
        currentIndex: 0,
        manga: { url, title: displayTitle, image: displayImage, source },
      });
      return;
    }

    const firstReadableIndex = readingChapterList.findIndex((ch) => ch.url);
    if (firstReadableIndex >= 0) {
      handleChapterPress(readingChapterList[firstReadableIndex]);
    }
  }, [
    lastHistory,
    readingChapterList,
    handleChapterPress,
    navigation,
    displayTitle,
    displayImage,
    source,
    url,
  ]);

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader title={routeTitle || 'Details'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={styles.loadingHint}>Loading details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error / no data state
  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader title={routeTitle || 'Details'} />
        <EmptyState
          icon="alert-circle-outline"
          title="Failed to load"
          subtitle="Could not load series details. Go back and try again."
        />
      </SafeAreaView>
    );
  }

  const ListHeader = () => {
    const canPrimaryRead = Boolean(lastHistory?.lastChapterUrl)
      || readingChapterList.some((ch) => ch.url);
    const primaryReadLabel = lastHistory?.lastChapterUrl ? 'Continue' : 'Start Reading';

    return (
      <>
      {/* Hero section with cover image */}
      <View style={styles.detailHero}>
        {displayImage ? (
          <ProtectedImage
            uri={displayImage}
            referer={url}
            style={styles.detailCover}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.detailCover, styles.detailCoverFallback]}>
            <Ionicons name="image-outline" size={42} color={THEME.textMuted} />
          </View>
        )}
        <View style={styles.heroOverlay} />

        <View style={styles.badgesRow}>
          <View style={styles.badge}>
            <Ionicons name="globe-outline" size={12} color={THEME.text} />
            <Text style={styles.badgeText}>{displaySource}</Text>
          </View>
          <View style={styles.badge}>
            <Ionicons name="book-outline" size={12} color={THEME.text} />
            <Text style={styles.badgeText}>
              {chapterCount} {chapterCount === 1 ? 'chapter' : 'chapters'}
            </Text>
          </View>
        </View>

        <Text style={styles.detailTitle} numberOfLines={3}>
          {displayTitle}
        </Text>
      </View>

      {/* Action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={handleBookmarkToggle}
          activeOpacity={0.8}
        >
          <Ionicons
            name={bookmarked ? 'bookmark' : 'bookmark-outline'}
            size={22}
            color={bookmarked ? THEME.primary : THEME.textSecondary}
          />
          <Text
            style={[
              styles.actionLabel,
              bookmarked && styles.actionLabelActive,
            ]}
          >
            {bookmarked ? 'Bookmarked' : 'Bookmark'}
          </Text>
        </TouchableOpacity>
        {canPrimaryRead ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.readActionBtn]}
            onPress={handlePrimaryRead}
            activeOpacity={0.8}
          >
            <Ionicons
              name={lastHistory?.lastChapterUrl ? 'play' : 'play-circle-outline'}
              size={22}
              color={THEME.text}
            />
            <Text style={[styles.actionLabel, styles.readActionLabel]}>
              {primaryReadLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Description */}
      {displayDescription ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text
            style={styles.descriptionText}
            numberOfLines={descExpanded ? undefined : 4}
          >
            {displayDescription}
          </Text>
          {displayDescription.length > 150 && (
            <Pressable
              onPress={() => setDescExpanded((prev) => !prev)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.readMore}>
                {descExpanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Chapter list header */}
      <View style={[styles.section, styles.chapterSection]}>
        <View style={styles.chapterHeaderRow}>
          <View style={styles.chapterHeaderText}>
            <Text style={styles.chapterTitle}>
              Chapters ({chapterCount})
            </Text>
            <Text style={styles.chapterMeta}>
              {chapterQuery.trim()
                ? `Showing ${visibleChapterCount} matches`
                : `${chapterOrder === 'desc' ? 'Newest' : 'Oldest'} first`}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.chapterOrderBtn}
            onPress={() => setChapterOrder((value) => (value === 'desc' ? 'asc' : 'desc'))}
            activeOpacity={0.8}
          >
            <Ionicons
              name={chapterOrder === 'desc' ? 'arrow-down' : 'arrow-up'}
              size={16}
              color={THEME.primary}
            />
            <Text style={styles.chapterOrderLabel}>
              {chapterOrder === 'desc' ? 'Newest' : 'Oldest'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chapterSearchBox}>
          <Ionicons name="search-outline" size={18} color={THEME.textMuted} />
          <TextInput
            value={chapterQuery}
            onChangeText={setChapterQuery}
            placeholder="Search chapter"
            placeholderTextColor={THEME.textMuted}
            style={styles.chapterSearchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {chapterQuery ? (
            <TouchableOpacity
              style={styles.chapterSearchClear}
              onPress={() => setChapterQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={THEME.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      </>
    );
  };

  const renderChapter = ({ item: ch }) => (
    <TouchableOpacity
      style={styles.chapterItem}
      activeOpacity={0.8}
      onPress={() => handleChapterPress(ch)}
      disabled={!ch?.url}
    >
      <View style={styles.chapterInfo}>
        <Ionicons
          name="document-text-outline"
          size={16}
          color={THEME.textSecondary}
          style={styles.chapterIcon}
        />
        <Text style={styles.chapterName} numberOfLines={1}>
          {ch?.name || 'Untitled chapter'}
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.downloadBtn,
          !downloadsAvailable && styles.downloadBtnDisabled,
        ]}
        onPress={() => handleDownload(ch?.url, ch?.name || 'Untitled chapter')}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        disabled={!downloadsAvailable || !ch?.url || downloading === ch.url}
        accessibilityLabel={downloadsAvailable ? 'Download chapter' : 'Downloads unavailable on web'}
      >
        {!downloadsAvailable ? (
          <Ionicons
            name="lock-closed-outline"
            size={21}
            color={THEME.textMuted}
          />
        ) : downloading === ch?.url ? (
          <ActivityIndicator size="small" color={THEME.primary} />
        ) : downloadedChapters.has(ch?.url) ? (
          <Ionicons
            name="checkmark-circle"
            size={22}
            color={THEME.success}
          />
        ) : (
          <Ionicons
            name="download-outline"
            size={22}
            color={THEME.textSecondary}
          />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const chapterKeyExtractor = (ch, index) => ch?.url || `chapter-${index}`;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlatList
        data={visibleChapterList}
        keyExtractor={chapterKeyExtractor}
        renderItem={renderChapter}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <Text style={styles.noChapters}>
            {chapterCount > 0 ? 'No matching chapters.' : 'No chapters available.'}
          </Text>
        }
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  scrollContent: {
    paddingBottom: THEME.space.xl * 3,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: THEME.space.xl,
  },
  loadingHint: {
    color: THEME.textSecondary,
    marginTop: THEME.space.md,
    fontSize: 14,
  },
  // Hero / cover
  detailHero: {
    position: 'relative',
    width: '100%',
    height: 280,
  },
  detailCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: 280,
  },
  detailCoverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.surface,
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11,17,32,0.55)',
  },
  badgesRow: {
    position: 'absolute',
    top: THEME.space.lg,
    left: THEME.space.lg,
    flexDirection: 'row',
    gap: THEME.space.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11,17,32,0.8)',
    paddingHorizontal: THEME.space.sm + 2,
    paddingVertical: THEME.space.xs + 2,
    borderRadius: THEME.radius.sm,
    gap: 4,
  },
  badgeText: {
    color: THEME.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  detailTitle: {
    position: 'absolute',
    bottom: THEME.space.lg,
    left: THEME.space.lg,
    right: THEME.space.lg,
    color: THEME.text,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  // Action bar
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: THEME.space.sm,
    paddingHorizontal: THEME.space.lg,
    paddingVertical: THEME.space.md,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  actionLabel: {
    color: THEME.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  actionLabelActive: {
    color: THEME.primary,
  },
  readActionBtn: {
    backgroundColor: THEME.primaryDark,
    borderColor: THEME.primary,
  },
  readActionLabel: {
    color: THEME.text,
  },
  // Sections
  section: {
    paddingHorizontal: THEME.space.lg,
    paddingTop: THEME.space.lg,
  },
  chapterSection: {
    paddingBottom: 0,
  },
  sectionTitle: {
    color: THEME.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: THEME.space.md,
  },
  descriptionText: {
    color: THEME.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  readMore: {
    color: THEME.primary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: THEME.space.sm,
  },
  // Chapter list
  chapterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: THEME.space.md,
    marginBottom: THEME.space.md,
  },
  chapterHeaderText: {
    flex: 1,
  },
  chapterTitle: {
    color: THEME.text,
    fontSize: 17,
    fontWeight: '700',
  },
  chapterMeta: {
    color: THEME.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  chapterOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: THEME.space.md,
    paddingVertical: THEME.space.sm,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  chapterOrderLabel: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: '700',
  },
  chapterSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: THEME.space.md,
  },
  chapterSearchInput: {
    flex: 1,
    color: THEME.text,
    fontSize: 14,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.sm,
  },
  chapterSearchClear: {
    padding: THEME.space.xs,
  },
  chapterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: THEME.space.sm,
    marginHorizontal: THEME.space.lg,
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.md,
  },
  chapterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: THEME.space.md,
  },
  chapterIcon: {
    marginRight: THEME.space.sm,
  },
  chapterName: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  downloadBtn: {
    padding: THEME.space.xs,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 32,
    minHeight: 32,
  },
  downloadBtnDisabled: {
    opacity: 0.45,
  },
  noChapters: {
    color: THEME.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: THEME.space.xl,
    paddingHorizontal: THEME.space.lg,
  },
});
