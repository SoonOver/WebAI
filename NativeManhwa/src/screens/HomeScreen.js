import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ALL_ID_SOURCE, Scraper, sanitizeCatalogFilters } from '../../scrapers';
import { THEME } from '../theme';
import { Storage } from '../storage';
import {
  ScreenHeader,
  SourceSegment,
  CatalogFilters,
  MangaCard,
  EmptyState,
  getGridColumnCount,
} from '../components/UIComponents';

const DEFAULT_SOURCE = Platform.OS === 'web' ? 'MangaDex (Bahasa Indonesia)' : ALL_ID_SOURCE;
const PAGINATED_SOURCES = new Set([
  ALL_ID_SOURCE,
  'BacaKomik',
  'Komik Station',
  'Komiku',
  'ManhwaRead',
  'MangaDex (JSON API)',
  'MangaDex (Bahasa Indonesia)',
  'Bato.to (ID)',
]);

function mangaResultKey(item) {
  return `${item?.source || 'unknown'}:${String(item?.url || '').trim()}`;
}

function dedupeMangaList(items = []) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const key = mangaResultKey(item);
    if (!item?.url || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function mergeMangaLists(current = [], next = []) {
  return dedupeMangaList([...current, ...next]);
}

export default function HomeScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const gridColumns = getGridColumnCount(width);
  const [manga, setManga] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [filters, setFilters] = useState(() => sanitizeCatalogFilters(DEFAULT_SOURCE));
  const [safeMode, setSafeMode] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const sourceRef = useRef(source);
  const filtersRef = useRef(filters);
  const loadIdRef = useRef(0);
  const effectiveFilters = useMemo(
    () => ({ ...filters, safeMode }),
    [filters, safeMode],
  );
  sourceRef.current = source;
  filtersRef.current = effectiveFilters;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Storage.getSettings()
        .then((settings) => {
          if (active) setSafeMode(settings.safeMode !== false);
        })
        .catch(() => {
          if (active) setSafeMode(true);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const fetchLatest = useCallback(
    async (pageNum) => {
      const currentSource = sourceRef.current;
      const currentFilters = filtersRef.current;
      const filterSignature = JSON.stringify(currentFilters);
      try {
        const data = await Scraper.fetchLatest(currentSource, pageNum, currentFilters);
        if (
          sourceRef.current !== currentSource ||
          JSON.stringify(filtersRef.current) !== filterSignature
        ) {
          return null;
        }
        if (!Array.isArray(data)) {
          return { list: [], hasMore: false };
        }
        const list = dedupeMangaList(
          data.filter((item) => typeof item?.url === 'string' && item.url.trim())
        );
        return {
          list,
          hasMore: PAGINATED_SOURCES.has(currentSource) && list.length >= 10,
        };
      } catch (err) {
        if (sourceRef.current !== currentSource) return null;
        throw err;
      }
    },
    [],
  );

  const load = useCallback(
    async (pageNum = 1) => {
      const loadId = ++loadIdRef.current;
      setError(null);
      if (pageNum === 1) {
        setLoading(true);
        setManga([]);
      } else {
        setLoadingMore(true);
      }
      setPage(pageNum);
      try {
        const result = await fetchLatest(pageNum);
        if (loadIdRef.current !== loadId || !result) return;
        setHasMore(result.hasMore);
        if (pageNum > 1) {
          setManga((prev) => mergeMangaLists(prev, result.list));
        } else {
          setManga(result.list);
        }
      } catch (err) {
        if (loadIdRef.current === loadId) {
          setError(`Error: ${err?.message || err}`);
          if (pageNum === 1) setManga([]);
        }
      } finally {
        if (loadIdRef.current === loadId) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [fetchLatest],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setHasMore(true);
    load(1);
  }, [load]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    const nextPage = page + 1;
    load(nextPage);
  }, [hasMore, loading, loadingMore, page, load]);

  const handleSourceChange = useCallback((nextSource) => {
    setSource(nextSource);
    setFilters((prev) => sanitizeCatalogFilters(nextSource, prev));
  }, []);

  useEffect(() => {
    load(1);
  }, [load, source, filters, safeMode]);

  const renderItem = useCallback(
    ({ item }) => (
      <MangaCard
        item={item}
        columns={gridColumns}
        onPress={() =>
          navigation.navigate('Details', {
            url: item?.url,
            title: item?.title,
            image: item?.image,
            source: item?.source,
          })
        }
      />
    ),
    [gridColumns, navigation],
  );

  const keyExtractor = useCallback(
    (item, i) => mangaResultKey(item) || `manga-${i}`,
    [],
  );

  const renderHeader = useCallback(
    () => (
      <>
        <ScreenHeader
          title="Discover"
          subtitle={safeMode ? 'Latest safe picks from your selected source' : 'Latest series from your selected source'}
        />
        <SourceSegment value={source} onChange={handleSourceChange} />
        <CatalogFilters source={source} value={filters} onChange={setFilters} />
      </>
    ),
    [source, filters, handleSourceChange, safeMode],
  );

  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={THEME.primary} />
        <Text style={styles.footerText}>Loading more…</Text>
      </View>
    );
  }, [loadingMore]);

  if (loading && page === 1) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader
          title="Discover"
          subtitle={safeMode ? 'Latest safe picks from your selected source' : 'Latest series from your selected source'}
        />
        <SourceSegment value={source} onChange={handleSourceChange} />
        <CatalogFilters source={source} value={filters} onChange={setFilters} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={styles.loadingHint}>Loading catalog…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && manga.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader
          title="Discover"
          subtitle={safeMode ? 'Latest safe picks from your selected source' : 'Latest series from your selected source'}
        />
        <SourceSegment value={source} onChange={handleSourceChange} />
        <CatalogFilters source={source} value={filters} onChange={setFilters} />
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={THEME.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => load(1)}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonLabel}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlatList
        key={`home-grid-${gridColumns}`}
        data={manga}
        keyExtractor={keyExtractor}
        numColumns={gridColumns}
        contentContainerStyle={[
          styles.list,
          manga.length === 0 && styles.listFlex,
        ]}
        columnWrapperStyle={gridColumns > 1 ? styles.row : undefined}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <EmptyState
            icon="albums-outline"
            title="Nothing here yet"
            subtitle="Try another source or pull down to refresh."
          />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={THEME.primary}
            colors={[THEME.primary]}
          />
        }
      />
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
  loadingHint: {
    color: THEME.textSecondary,
    marginTop: THEME.space.md,
    fontSize: 14,
  },
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
  primaryButtonLabel: {
    color: THEME.text,
    fontWeight: '700',
    fontSize: 15,
  },
  footerLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: THEME.space.lg,
  },
  footerText: {
    color: THEME.textSecondary,
    fontSize: 13,
    marginLeft: THEME.space.sm,
  },
});
