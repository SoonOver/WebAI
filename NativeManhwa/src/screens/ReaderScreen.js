import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Scraper } from '../../scrapers';
import { THEME } from '../theme';
import { AutoHeightImage } from '../components/UIComponents';
import { DownloadManager, Storage } from '../storage';

export default function ReaderScreen({ route, navigation }) {
  const params = route?.params || {};
  const url = typeof params.url === 'string' ? params.url : '';
  const title = typeof params.title === 'string' && params.title.trim()
    ? params.title.trim()
    : 'Reader';
  const source = typeof params.source === 'string' ? params.source : '';
  const routeManga = params.manga && typeof params.manga === 'object'
    ? params.manga
    : {};
  const mangaUrl = typeof routeManga.url === 'string' ? routeManga.url : '';
  const mangaTitle = typeof routeManga.title === 'string' && routeManga.title.trim()
    ? routeManga.title.trim()
    : title;
  const mangaImage = typeof routeManga.image === 'string' ? routeManga.image : '';
  const mangaSource = typeof routeManga.source === 'string' ? routeManga.source : source;
  const routeChapters = Array.isArray(params.chapters) ? params.chapters : [];
  const chapters = useMemo(
    () =>
      routeChapters
        .filter((ch) => ch && typeof ch === 'object')
        .map((ch, index) => ({
          ...ch,
          url: typeof ch.url === 'string' ? ch.url : '',
          name: typeof ch.name === 'string' && ch.name.trim()
            ? ch.name.trim()
            : `Chapter ${index + 1}`,
        })),
    [routeChapters],
  );
  const parsedIndex = Number(params.currentIndex);
  const currentIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0
    ? Math.min(parsedIndex, Math.max(chapters.length - 1, 0))
    : 0;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [images, setImages] = useState([]);
  const [imageMetrics, setImageMetrics] = useState({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('webtoon');
  const [errorMessage, setErrorMessage] = useState('');
  const [settings, setSettings] = useState({
    autoAdvance: false,
    cacheEnabled: true,
    imageQuality: 'sharp',
    readerMode: 'webtoon',
  });
  const settingsRef = useRef(settings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [changingChapter, setChangingChapter] = useState(false);
  const changingChapterRef = useRef(false);
  const loadGenRef = useRef(0);

  // Load settings on mount and whenever screen is focused
  useFocusEffect(
    useCallback(() => {
      Storage.getSettings().then(s => {
        setSettings(s);
        settingsRef.current = s;
        setMode(s.readerMode === 'manga' ? 'manga' : 'webtoon');
        setSettingsLoaded(true);
      }).catch(() => setSettingsLoaded(true));
    }, [])
  );

  const loadImages = async (targetUrl, retryCount = 0, gen) => {
    const currentGen = gen ?? ++loadGenRef.current;
    setLoading(true);
    setErrorMessage('');
    setImageMetrics({});
    try {
      if (!targetUrl) {
        throw new Error('Missing chapter URL');
      }
      const local = await DownloadManager.getLocalUri(targetUrl);
      if (local) {
        if (loadGenRef.current !== currentGen) return;
        setImages(local);
      } else {
        const remote = await Scraper.fetchImages(source, targetUrl);
        if (!remote || remote.length === 0) {
          throw new Error('No images returned from source');
        }
        if (settingsRef.current.cacheEnabled) {
          if (loadGenRef.current !== currentGen) return;
          setImages(remote);
          Promise.allSettled(
            remote.map(img => DownloadManager.cacheImage(img, targetUrl))
          ).then((cachedResults) => {
            if (loadGenRef.current !== currentGen) return;
            const finalImages = cachedResults.map((r, i) =>
              r.status === 'fulfilled' && r.value ? r.value : remote[i]
            );
            setImages(finalImages);
          });
        } else {
          if (loadGenRef.current !== currentGen) return;
          setImages(remote || []);
        }
      }
    } catch (error) {
      const errMsg = String(error?.message || error).slice(0, 220);

      // Auto-retry once after a short delay
      if (retryCount < 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (loadGenRef.current !== currentGen) return;
        return loadImages(targetUrl, retryCount + 1, currentGen);
      }

      if (loadGenRef.current !== currentGen) return;
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
        userMessage = 'Could not load chapter images from this source. Try another source.';
      }
      Alert.alert('Error', `${userMessage}\n\n[Log: ${errMsg}]`);
    }
    if (loadGenRef.current === currentGen) setLoading(false);
  };

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    loadImages(url).then(() => {
      if (!cancelled) { setChangingChapter(false); changingChapterRef.current = false; }
    });
    return () => {
      cancelled = true;
      loadGenRef.current += 1;
    };
  }, [url, source, settingsLoaded]);

  const canGoPrev = currentIndex > 0 && Boolean(chapters[currentIndex - 1]?.url);
  const canGoNext = currentIndex < chapters.length - 1 && Boolean(chapters[currentIndex + 1]?.url);
  const pageCountLabel = `${images.length} page${images.length === 1 ? '' : 's'}`;
  const measuredImageWidths = useMemo(
    () => Object.values(imageMetrics)
      .map((size) => Number(size?.width))
      .filter((width) => Number.isFinite(width) && width > 0),
    [imageMetrics],
  );
  const sourceWidthLabel = measuredImageWidths.length > 0
    ? `${Math.min(...measuredImageWidths)}px source`
    : '';
  const baseReaderProgress = chapters.length > 0
    ? `${currentIndex + 1} / ${chapters.length}${images.length > 0 ? ` · ${pageCountLabel}` : ''}`
    : pageCountLabel;
  const readerProgress = sourceWidthLabel
    ? `${baseReaderProgress} · ${sourceWidthLabel}`
    : baseReaderProgress;

  const toggleReaderMode = useCallback(async () => {
    const nextMode = mode === 'webtoon' ? 'manga' : 'webtoon';
    const nextSettings = { ...settingsRef.current, readerMode: nextMode };
    setMode(nextMode);
    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    try {
      await Storage.saveSettings(nextSettings);
    } catch (_) {}
  }, [mode]);

  const saveReaderHistory = useCallback((chapter) => {
    if (!mangaUrl || !chapter?.url) return;
    Storage.addHistory(
      {
        url: mangaUrl,
        title: mangaTitle,
        image: mangaImage,
        source: mangaSource,
      },
      chapter.name || title,
      chapter.url,
    ).catch(() => {});
  }, [mangaUrl, mangaTitle, mangaImage, mangaSource, title]);

  const handleImageSize = useCallback((index, size) => {
    if (!size?.uri || !size.width || !size.height) return;
    const key = `${index}:${size.uri}`;
    setImageMetrics((prev) => {
      const current = prev[key];
      if (current?.width === size.width && current?.height === size.height) return prev;
      return {
        ...prev,
        [key]: {
          width: size.width,
          height: size.height,
        },
      };
    });
  }, []);

  useEffect(() => {
    const currentChapter = chapters[currentIndex] || { url, name: title };
    saveReaderHistory(currentChapter);
  }, [url, title, currentIndex, chapters, saveReaderHistory]);

  const goPrevChapter = () => {
    if (changingChapterRef.current) return;
    if (canGoPrev) {
      const prev = chapters[currentIndex - 1];
      saveReaderHistory(prev);
      changingChapterRef.current = true;
      setChangingChapter(true);
      navigation.setParams({ url: prev.url, title: prev.name, currentIndex: currentIndex - 1 });
    }
  };

  const goNextChapter = () => {
    if (changingChapterRef.current) return;
    if (canGoNext) {
      const nxt = chapters[currentIndex + 1];
      saveReaderHistory(nxt);
      changingChapterRef.current = true;
      setChangingChapter(true);
      navigation.setParams({ url: nxt.url, title: nxt.name, currentIndex: currentIndex + 1 });
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
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={6}
            accessibilityLabel="Back"
            activeOpacity={0.72}
            style={styles.readerIconButton}
          >
            <Ionicons name="chevron-back" size={26} color={THEME.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goPrevChapter}
            hitSlop={6}
            disabled={!canGoPrev || changingChapter}
            accessibilityLabel="Previous chapter"
            activeOpacity={0.72}
            style={[
              styles.readerIconButton,
              (!canGoPrev || changingChapter) && styles.readerIconButtonDisabled,
            ]}
          >
            <Ionicons
              name="play-skip-back"
              size={22}
              color={!canGoPrev || changingChapter ? THEME.textMuted : THEME.text}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.readerTitleWrap}>
          <Text style={styles.readerTitle} numberOfLines={1}>
            {title || 'Reader'}
          </Text>
          <Text style={styles.readerSubtitle} numberOfLines={1}>
            {readerProgress}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={goNextChapter}
            hitSlop={6}
            disabled={!canGoNext || changingChapter}
            accessibilityLabel="Next chapter"
            activeOpacity={0.72}
            style={[
              styles.readerIconButton,
              (!canGoNext || changingChapter) && styles.readerIconButtonDisabled,
            ]}
          >
            <Ionicons
              name="play-skip-forward"
              size={22}
              color={!canGoNext || changingChapter ? THEME.textMuted : THEME.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleReaderMode}
            hitSlop={6}
            accessibilityLabel={mode === 'webtoon' ? 'Switch to page mode' : 'Switch to scroll mode'}
            activeOpacity={0.72}
            style={styles.readerIconButton}
          >
            <Ionicons
              name={mode === 'webtoon' ? 'book-outline' : 'phone-portrait-outline'}
              size={24}
              color={THEME.text}
            />
          </TouchableOpacity>
        </View>
      </View>
      {images.length === 0 ? (
        <View style={styles.readerEmpty}>
          <Ionicons name="image-outline" size={48} color={THEME.textMuted} />
          <Text style={styles.readerEmptyText}>No pages loaded</Text>
          {errorMessage ? (
            <Text style={styles.readerErrorText} numberOfLines={4}>
              {errorMessage}
            </Text>
          ) : null}
          <TouchableOpacity style={styles.primaryButton} onPress={() => loadImages(url, 0)} activeOpacity={0.85}>
            <Text style={styles.primaryButtonLabel}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={mode}
          data={images}
          keyExtractor={(_, i) => i.toString()}
          initialNumToRender={mode === 'webtoon' ? 3 : 1}
          maxToRenderPerBatch={mode === 'webtoon' ? 4 : 2}
          windowSize={mode === 'webtoon' ? 7 : 3}
          removeClippedSubviews={false}
          horizontal={mode === 'manga'}
          pagingEnabled={mode === 'manga'}
          onEndReached={() => { if (settings.autoAdvance && canGoNext) goNextChapter(); }}
          onEndReachedThreshold={0.5}
          getItemLayout={mode === 'manga' ? (_, index) => ({
            length: screenWidth,
            offset: screenWidth * index,
            index,
          }) : undefined}
          contentContainerStyle={
            mode === 'webtoon'
              ? { paddingTop: headerPadTop + 58, paddingBottom: insets.bottom + THEME.space.lg }
              : undefined
          }
          renderItem={({ item, index }) => (
            <AutoHeightImage
              source={item}
              referer={url}
              fit={mode === 'manga' ? 'contain' : 'width'}
              topInset={mode === 'manga' ? headerPadTop + 58 : 0}
              bottomInset={mode === 'manga' ? insets.bottom + THEME.space.sm : 0}
              qualityMode={settings.imageQuality}
              onSize={(size) => handleImageSize(index, size)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  readerRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: THEME.space.xl,
  },
  loadingHintDark: {
    color: THEME.textSecondary,
    marginTop: THEME.space.md,
    fontSize: 14,
  },
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readerIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: THEME.radius.sm,
  },
  readerIconButtonDisabled: {
    opacity: 0.45,
  },
  readerTitleWrap: {
    flex: 1,
    marginHorizontal: THEME.space.sm,
    minWidth: 0,
  },
  readerTitle: {
    color: THEME.text,
    fontWeight: '600',
    fontSize: 15,
    textAlign: 'center',
  },
  readerSubtitle: {
    color: THEME.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  readerEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: THEME.space.xl,
  },
  readerEmptyText: {
    color: THEME.textSecondary,
    marginTop: THEME.space.md,
    marginBottom: THEME.space.sm,
  },
  readerErrorText: {
    color: THEME.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: THEME.space.lg,
    paddingHorizontal: THEME.space.lg,
  },
  primaryButton: {
    backgroundColor: THEME.primaryDark,
    paddingVertical: THEME.space.md,
    paddingHorizontal: THEME.space.xl * 2,
    borderRadius: THEME.radius.md,
  },
  primaryButtonLabel: {
    color: THEME.text,
    fontWeight: '700',
    fontSize: 15,
  },
});
