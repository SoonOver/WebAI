import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../theme';
import { ScreenHeader, EmptyState, ProtectedImage } from '../components/UIComponents';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Storage } from '../storage';

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { dateStyle: 'short' });
}

export default function HistoryScreen({ navigation }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await Storage.getHistory();
      setHistory(data);
    } catch (err) {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const deleteEntry = useCallback(
    (entry) => {
      Alert.alert(
        'Remove from History',
        `Delete "${entry.title || 'this entry'}" from your history?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                const current = await Storage.getHistory();
                const updated = current.filter(
                  (item) => item.url !== entry.url
                );
                await AsyncStorage.setItem(
                  '@history',
                  JSON.stringify(updated)
                );
                setHistory(updated);
              } catch (err) {
                Alert.alert('Error', 'Failed to delete history entry.');
              }
            },
          },
        ]
      );
    },
    []
  );

  const renderItem = useCallback(
    ({ item }) => (
      <TouchableOpacity
        style={styles.historyRow}
        activeOpacity={0.85}
        onPress={() => {
          const chapterUrl = typeof item.lastChapterUrl === 'string'
            ? item.lastChapterUrl
            : '';
          const chapterName = typeof item.lastChapter === 'string' && item.lastChapter.trim()
            ? item.lastChapter.trim()
            : item.title;
          if (chapterUrl) {
            navigation.navigate('Reader', {
              url: chapterUrl,
              title: chapterName,
              source: item.source,
              chapters: [{ url: chapterUrl, name: chapterName }],
              currentIndex: 0,
              manga: {
                url: item.url,
                title: item.title,
                image: item.image,
                source: item.source,
              },
            });
            return;
          }
          navigation.navigate('Details', {
            url: item.url,
            title: item.title,
            image: item.image,
            source: item.source,
          });
        }}
        onLongPress={() => deleteEntry(item)}
      >
        {item.image ? (
          <ProtectedImage
            uri={item.image}
            referer={item.url}
            style={styles.historyThumb}
          />
        ) : (
          <View style={[styles.historyThumb, styles.historyThumbFallback]}>
            <Ionicons name="image-outline" size={22} color={THEME.textMuted} />
          </View>
        )}
        <View style={styles.historyMeta}>
          <Text style={styles.historyTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.lastChapter ? (
            <Text style={styles.historyChapter} numberOfLines={1}>
              {item.lastChapter}
            </Text>
          ) : null}
          <Text style={styles.historyDate}>
            {formatTime(item.timestamp)}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={THEME.textMuted}
        />
      </TouchableOpacity>
    ),
    [navigation, deleteEntry]
  );

  const keyExtractor = useCallback(
    (item, index) =>
      item.url ? `${item.url}-${item.timestamp || index}` : `${index}`,
    []
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScreenHeader
          title="History"
          subtitle="Recently read chapters"
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title="History"
        subtitle="Recently read chapters"
      />
      <FlatList
        data={history}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.list,
          history.length === 0 && styles.listFlex,
        ]}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            icon="time-outline"
            title="No history yet"
            subtitle="Chapters you read will appear here."
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
  list: {
    paddingHorizontal: THEME.space.lg,
    paddingBottom: THEME.space.xl * 6,
  },
  listFlex: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: THEME.space.xl,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.md,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: THEME.space.md,
    padding: THEME.space.md,
  },
  historyThumb: {
    width: 52,
    height: 72,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surface,
    marginRight: THEME.space.md,
  },
  historyThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyMeta: {
    flex: 1,
    marginRight: THEME.space.sm,
  },
  historyTitle: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  historyChapter: {
    color: THEME.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  historyDate: {
    color: THEME.textMuted,
    fontSize: 12,
    marginTop: THEME.space.xs,
  },
});
