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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ALL_ID_SOURCE, Scraper, sanitizeCatalogFilters, sourceShortLabel } from '../../scrapers';
import { THEME } from '../theme';
import { Storage } from '../storage';
import {
  ScreenHeader,
  SourceSegment,
  CatalogFilters,
  MangaShelfCard,
  EmptyState,
} from '../components/UIComponents';

const DEFAULT_SOURCE = Platform.OS === 'web' ? 'MangaDex (Bahasa Indonesia)' : ALL_ID_SOURCE;
const SHELF_LIMIT = 24;

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

function shelfItems(items = []) {
  return dedupeMangaList(items)
    .filter((item) => typeof item?.url === 'string' && item.url.trim())
    .slice(0, SHELF_LIMIT);
}

function sectionSubtitle(source, safeMode) {
  const label = sourceShortLabel(source);
  if (source === ALL_ID_SOURCE) {
    return safeMode
      ? 'Trending and fresh safe updates across Indonesian providers'
      : 'Trending and fresh updates across Indonesian providers';
  }
  return safeMode
    ? `Trending and fresh safe updates from ${label}`
    : `Trending and fresh updates from ${label}`;
}

function ShelfSection({ title, subtitle, items, loading, icon, navigation }) {
  const openDetails = useCallback(
    (item) => {
      navigation.navigate('Details', {
        url: item?.url,
        title: item?.title,
        image: item?.image,
        source: item?.source,
      });
    },
    [navigation],
  );

  return (
    <View style={styles.shelfSection}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionIcon}>
            <Ionicons name={icon} size={16} color={THEME.primary} />
          </View>
          <View style={styles.sectionText}>
            <Text style={styles.shelfTitle}>{title}</Text>
            {subtitle ? (
              <Text style={styles.shelfSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.shelfLoading}>
          <ActivityIndicator size="small" color={THEME.primary} />
          <Text style={styles.shelfLoadingText}>Loading {title.toLowerCase()}...</Text>
        </View>
      ) : items.length > 0 ? (
        <FlatList
          data={items}
          horizontal
          keyExtractor={(item, index) => mangaResultKey(item) || `${title}-${index}`}
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={styles.shelfList}
          renderItem={({ item, index }) => (
            <MangaShelfCard
              item={item}
              rank={title === 'Trending' ? index + 1 : undefined}
              onPress={() => openDetails(item)}
            />
          )}
        />
      ) : (
        <View style={styles.shelfEmpty}>
          <Text style={styles.shelfEmptyText}>No titles loaded for this section.</Text>
        </View>
      )}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const [sections, setSections] = useState({ trending: [], latest: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [filters, setFilters] = useState(() => sanitizeCatalogFilters(DEFAULT_SOURCE));
  const [safeMode, setSafeMode] = useState(true);
  const sourceRef = useRef(source);
  const filtersRef = useRef(filters);
  const loadIdRef = useRef(0);
  const effectiveFilters = useMemo(
    () => ({ ...filters, safeMode }),
    [filters, safeMode],
  );
  const hasAnyItems = sections.trending.length > 0 || sections.latest.length > 0;
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

  const load = useCallback(async () => {
    const currentSource = sourceRef.current;
    const currentFilters = filtersRef.current;
    const filterSignature = JSON.stringify(currentFilters);
    const loadId = ++loadIdRef.current;
    setError(null);
    setLoading(true);
    try {
      const trendingFilters = { ...currentFilters, sort: 'popular' };
      const latestFilters = { ...currentFilters, sort: 'updated' };
      const [trendingResult, latestResult] = await Promise.allSettled([
        Scraper.fetchTrending(currentSource, 1, trendingFilters),
        Scraper.fetchLatest(currentSource, 1, latestFilters),
      ]);
      if (
        loadIdRef.current !== loadId ||
        sourceRef.current !== currentSource ||
        JSON.stringify(filtersRef.current) !== filterSignature
      ) {
        return;
      }
      const trending = trendingResult.status === 'fulfilled'
        ? shelfItems(trendingResult.value)
        : [];
      const latest = latestResult.status === 'fulfilled'
        ? shelfItems(latestResult.value)
        : [];
      setSections({ trending, latest });
      if (trending.length === 0 && latest.length === 0) {
        const reason = [trendingResult, latestResult]
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason?.message || String(result.reason))
          .filter(Boolean)
          .join(' / ');
        setError(reason ? `Error: ${reason}` : 'No titles returned from this provider.');
      }
    } catch (err) {
      if (loadIdRef.current === loadId) {
        setError(`Error: ${err?.message || err}`);
        setSections({ trending: [], latest: [] });
      }
    } finally {
      if (loadIdRef.current === loadId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleSourceChange = useCallback((nextSource) => {
    setSource(nextSource);
    setFilters((prev) => sanitizeCatalogFilters(nextSource, prev));
    setSections({ trending: [], latest: [] });
  }, []);

  useEffect(() => {
    load();
  }, [load, source, filters, safeMode]);

  if (loading && !hasAnyItems) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader
          title="Discover"
          subtitle={sectionSubtitle(source, safeMode)}
        />
        <SourceSegment value={source} onChange={handleSourceChange} />
        <CatalogFilters
          source={source}
          value={filters}
          onChange={setFilters}
          omitKeys={['sort']}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={styles.loadingHint}>Loading shelves...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !hasAnyItems) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader
          title="Discover"
          subtitle={sectionSubtitle(source, safeMode)}
        />
        <SourceSegment value={source} onChange={handleSourceChange} />
        <CatalogFilters
          source={source}
          value={filters}
          onChange={setFilters}
          omitKeys={['sort']}
        />
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={THEME.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={load}
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={THEME.primary}
            colors={[THEME.primary]}
          />
        }
      >
        <ScreenHeader
          title="Discover"
          subtitle={sectionSubtitle(source, safeMode)}
        />
        <SourceSegment value={source} onChange={handleSourceChange} />
        <CatalogFilters
          source={source}
          value={filters}
          onChange={setFilters}
          omitKeys={['sort']}
        />

        <ShelfSection
          title="Trending"
          subtitle="Popular picks from the selected provider"
          icon="flame-outline"
          items={sections.trending}
          loading={loading}
          navigation={navigation}
        />
        <ShelfSection
          title="Update terbaru"
          subtitle="Fresh chapters and recently updated titles"
          icon="time-outline"
          items={sections.latest}
          loading={loading}
          navigation={navigation}
        />

        {!loading && !hasAnyItems ? (
          <EmptyState
            icon="albums-outline"
            title="Nothing here yet"
            subtitle="Try another source or pull down to refresh."
          />
        ) : null}
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: THEME.space.xl,
  },
  scrollContent: {
    paddingBottom: THEME.space.xl * 6,
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
  shelfSection: {
    marginTop: THEME.space.lg,
  },
  sectionHeading: {
    paddingHorizontal: THEME.space.lg,
    marginBottom: THEME.space.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: THEME.space.sm,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: THEME.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  sectionText: {
    flex: 1,
    minWidth: 0,
  },
  shelfTitle: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  shelfSubtitle: {
    color: THEME.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  shelfList: {
    paddingHorizontal: THEME.space.lg,
    paddingRight: THEME.space.xl,
  },
  shelfLoading: {
    minHeight: 190,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: THEME.space.lg,
  },
  shelfLoadingText: {
    color: THEME.textSecondary,
    fontSize: 13,
    marginLeft: THEME.space.sm,
  },
  shelfEmpty: {
    minHeight: 120,
    justifyContent: 'center',
    marginHorizontal: THEME.space.lg,
    paddingHorizontal: THEME.space.lg,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  shelfEmptyText: {
    color: THEME.textMuted,
    fontSize: 13,
  },
  bottomSpacer: {
    height: THEME.space.xl,
  },
});
