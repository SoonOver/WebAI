import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Keyboard,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ALL_ID_SOURCE, Scraper, sanitizeCatalogFilters } from '../../scrapers';
import { THEME } from '../theme';
import {
  ScreenHeader,
  SourceSegment,
  CatalogFilters,
  MangaCard,
  EmptyState,
} from '../components/UIComponents';

const DEFAULT_SOURCE = Platform.OS === 'web' ? 'MangaDex (Bahasa Indonesia)' : ALL_ID_SOURCE;
const QUICK_SEARCHES = [
  'The Greatest Estate Developer',
  'I Will Teach You Self Defense',
  'Eleceed',
  'Solo Leveling',
  'Lookism',
];

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [manga, setManga] = useState([]);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [filters, setFilters] = useState(() => sanitizeCatalogFilters(DEFAULT_SOURCE));
  const [searching, setSearching] = useState(false);
  const searchIdRef = useRef(0);
  const showQuickSearch = source === ALL_ID_SOURCE;

  useEffect(() => {
    searchIdRef.current += 1;
    setManga([]);
    setSubmittedQuery('');
    setSearching(false);
  }, [source, filters]);

  const handleQueryChange = useCallback((nextValue) => {
    setQuery(nextValue);
    setSubmittedQuery('');
    setManga([]);
  }, []);

  const handleSourceChange = useCallback((nextSource) => {
    setSource(nextSource);
    setFilters((prev) => sanitizeCatalogFilters(nextSource, prev));
  }, []);

  const search = useCallback(async (nextQuery = query) => {
    const trimmedQuery = String(nextQuery || '').trim();
    if (!trimmedQuery) {
      setSubmittedQuery('');
      setManga([]);
      return;
    }
    Keyboard.dismiss();
    const searchId = ++searchIdRef.current;
    setSearching(true);
    try {
      const data = await Scraper.fetchSearch(source, trimmedQuery, filters);
      if (searchIdRef.current === searchId) {
        setSubmittedQuery(trimmedQuery);
        setManga(
          Array.isArray(data)
            ? data.filter((item) => typeof item?.url === 'string' && item.url.trim())
            : []
        );
      }
    } catch (err) {
      if (searchIdRef.current === searchId) {
        setSubmittedQuery(trimmedQuery);
        Alert.alert('Search failed', 'Please check your connection and try again.');
        setManga([]);
      }
    } finally {
      if (searchIdRef.current === searchId) {
        setSearching(false);
      }
    }
  }, [source, query, filters]);

  const handleQuickSearch = useCallback((term) => {
    setQuery(term);
    search(term);
  }, [search]);

  const renderEmpty = () => {
    if (searching) return null;
    if (submittedQuery && manga.length === 0) {
      return (
        <EmptyState
          icon="search-outline"
          title="No matches"
          subtitle="Try a different keyword or switch source."
        />
      );
    }
    if (query.trim()) {
      return (
        <EmptyState
          icon="search-outline"
          title="Ready to search"
          subtitle="Tap Go to search this source."
        />
      );
    }
    return (
      <EmptyState
        icon="search"
        title="Start typing"
        subtitle="Search by title or keyword, then tap Go."
      />
    );
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
          onChangeText={handleQueryChange}
          onSubmitEditing={() => search()}
          returnKeyType="search"
          blurOnSubmit
        />
        {query ? (
          <TouchableOpacity
            accessibilityLabel="Clear search"
            onPress={() => handleQueryChange('')}
            style={styles.searchClear}
            activeOpacity={0.75}
          >
            <Ionicons name="close-circle" size={18} color={THEME.textMuted} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => search()}
          style={[styles.searchGo, !query.trim() && styles.searchGoDisabled]}
          activeOpacity={0.8}
          disabled={!query.trim() || searching}
        >
          {searching ? (
            <ActivityIndicator size="small" color={THEME.text} />
          ) : (
            <Text style={styles.searchGoText}>Go</Text>
          )}
        </TouchableOpacity>
      </View>
      {showQuickSearch ? (
        <View style={styles.quickSearchWrap}>
          <Text style={styles.quickSearchLabel}>Quick search</Text>
          <FlatList
            horizontal
            data={QUICK_SEARCHES}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.quickSearchList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.quickSearchChip,
                  submittedQuery === item && styles.quickSearchChipActive,
                ]}
                onPress={() => handleQuickSearch(item)}
                activeOpacity={0.78}
                disabled={searching && submittedQuery === item}
              >
                <Ionicons name="flash-outline" size={13} color={THEME.primary} />
                <Text style={styles.quickSearchText} numberOfLines={1}>
                  {item}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : null}
      <SourceSegment value={source} onChange={handleSourceChange} />
      <CatalogFilters source={source} value={filters} onChange={setFilters} />
      {searching ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
        </View>
      ) : (
        <FlatList
          data={manga}
          keyExtractor={(item, i) => `${item?.url || 'search-result'}-${i}`}
          numColumns={2}
          contentContainerStyle={[styles.list, manga.length === 0 && styles.listFlex]}
          columnWrapperStyle={styles.row}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <MangaCard
              item={item}
              onPress={() =>
                navigation.navigate('Details', {
                  url: item?.url,
                  title: item?.title,
                  image: item?.image,
                  source: item?.source,
                })
              }
            />
          )}
          ListEmptyComponent={renderEmpty}
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: THEME.space.lg,
    marginBottom: THEME.space.md,
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: THEME.space.md,
  },
  searchIcon: {
    marginRight: THEME.space.sm,
  },
  searchInput: {
    flex: 1,
    color: THEME.text,
    fontSize: 15,
    paddingVertical: THEME.space.md,
  },
  searchGo: {
    minWidth: 64,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.primaryDark,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.lg,
    borderRadius: THEME.radius.sm,
    marginLeft: THEME.space.sm,
  },
  searchClear: {
    width: 34,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: THEME.space.xs,
  },
  searchGoDisabled: {
    opacity: 0.45,
  },
  searchGoText: {
    color: THEME.text,
    fontWeight: '700',
    fontSize: 14,
  },
  quickSearchWrap: {
    marginBottom: THEME.space.sm,
  },
  quickSearchLabel: {
    color: THEME.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    paddingHorizontal: THEME.space.lg,
    marginBottom: THEME.space.xs,
    letterSpacing: 0,
  },
  quickSearchList: {
    paddingHorizontal: THEME.space.lg,
    paddingRight: THEME.space.xl,
    gap: THEME.space.sm,
  },
  quickSearchChip: {
    minHeight: 34,
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.pill,
    backgroundColor: THEME.surfaceElevated,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  quickSearchChipActive: {
    borderColor: THEME.primary,
    backgroundColor: THEME.surface,
  },
  quickSearchText: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
});
