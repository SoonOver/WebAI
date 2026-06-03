import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, Pressable, ScrollView, Platform, TouchableOpacity, StyleSheet, useWindowDimensions, PixelRatio, Animated } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../theme';
import {
  HEADERS,
  SOURCE_PICKER_ORDER,
  WEB_SOURCE_ORDER,
  sourceShortLabel,
  getCatalogFilterGroups,
  sanitizeCatalogFilters,
  countActiveCatalogFilters,
} from '../../scrapers';

function isBatoCdnImage(uri) {
  return /merrypsycho\.xyz/i.test(String(uri || ''));
}

function imageHeaders(referer, imageUri) {
  const headers = {
    ...HEADERS,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  if (isBatoCdnImage(imageUri)) {
    headers.Referer = 'https://bbato.com/';
  } else if (referer && String(referer).startsWith('http')) {
    headers.Referer = referer;
  }
  return headers;
}

const PROTECTED_IMAGE_CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}imgcache/protected-images/`
  : null;
const protectedImageDownloads = new Map();
const HIGH_QUALITY_IMAGE_PROPS = Platform.OS === 'android'
  ? { resizeMethod: 'scale', progressiveRenderingEnabled: true, fadeDuration: 0 }
  : {};
const DEVICE_PIXEL_RATIO = Math.max(1, PixelRatio.get());
const SHARP_MAX_UPSCALE = 1.35;

function protectedImageHash(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function imageExtension(uri) {
  const match = String(uri || '').match(/\.(webp|png|jpe?g|gif)(?:[?#].*)?$/i);
  if (!match) return '.img';
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? '.jpg' : `.${ext}`;
}

function canCacheProtectedImage(uri) {
  return Platform.OS !== 'web' && Boolean(PROTECTED_IMAGE_CACHE_DIR) && isBatoCdnImage(uri);
}

async function cacheProtectedImage(uri, referer) {
  if (!canCacheProtectedImage(uri)) return '';
  const target = `${PROTECTED_IMAGE_CACHE_DIR}${protectedImageHash(uri)}${imageExtension(uri)}`;
  const cached = await FileSystem.getInfoAsync(target);
  if (cached.exists && (!Number.isFinite(cached.size) || cached.size > 0)) return target;
  if (cached.exists) await FileSystem.deleteAsync(target, { idempotent: true });
  if (protectedImageDownloads.has(uri)) return protectedImageDownloads.get(uri);

  const task = (async () => {
    await FileSystem.makeDirectoryAsync(PROTECTED_IMAGE_CACHE_DIR, { intermediates: true });
    const result = await FileSystem.downloadAsync(uri, target, {
      headers: imageHeaders(referer, uri),
    });
    if (result.status >= 200 && result.status < 300) return result.uri;
    await FileSystem.deleteAsync(target, { idempotent: true });
    return '';
  })().finally(() => protectedImageDownloads.delete(uri));

  protectedImageDownloads.set(uri, task);
  return task;
}

function useProtectedImageUri(uri, referer) {
  const [localUri, setLocalUri] = useState('');

  useEffect(() => {
    let active = true;
    setLocalUri('');
    if (!canCacheProtectedImage(uri)) return () => { active = false; };

    cacheProtectedImage(uri, referer)
      .then((cachedUri) => {
        if (active && cachedUri) setLocalUri(cachedUri);
      })
      .catch(() => {
        if (active) setLocalUri('');
      });

    return () => {
      active = false;
    };
  }, [referer, uri]);

  return localUri || uri;
}

function imageSource(uri, referer) {
  if (!uri) return null;
  if (
    Platform.OS === 'web' ||
    String(uri).startsWith('file://') ||
    String(uri).startsWith('content://')
  ) {
    return { uri };
  }
  return { uri, headers: imageHeaders(referer, uri) };
}

export function ProtectedImage({ uri, referer, style, resizeMode = 'cover', onError }) {
  const imageUri = typeof uri === 'string' ? uri : '';
  const resolvedUri = useProtectedImageUri(imageUri, referer);
  const source = imageSource(resolvedUri, referer);
  if (!source) return null;
  return (
    <Image
      source={source}
      style={style}
      resizeMode={resizeMode}
      {...HIGH_QUALITY_IMAGE_PROPS}
      onError={onError}
    />
  );
}

function ImageFallback({ height = 300, width }) {
  return (
    <View style={[styles.imageFallback, { width, height }]}>
      <Ionicons name="image-outline" size={32} color={THEME.textMuted} />
      <Text style={styles.imageFallbackText}>No image</Text>
    </View>
  );
}

function nativePixelWidth(layoutWidth, naturalWidth, qualityMode) {
  if (qualityMode !== 'sharp' || !naturalWidth || naturalWidth <= 0) return layoutWidth;
  return Math.max(1, Math.min(layoutWidth, (naturalWidth * SHARP_MAX_UPSCALE) / DEVICE_PIXEL_RATIO));
}

function FadeInImage({ imageKey, style, onLoad, ...props }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
  }, [imageKey, opacity]);

  const handleLoad = (event) => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
    if (onLoad) onLoad(event);
  };

  return (
    <Animated.Image
      {...props}
      style={[style, { opacity }]}
      onLoad={handleLoad}
    />
  );
}

export function AutoHeightImage({
  source,
  referer,
  fit = 'width',
  topInset = 0,
  bottomInset = 0,
  qualityMode = 'sharp',
  onSize,
}) {
  const { width, height: windowHeight } = useWindowDimensions();
  const sourceUri = typeof source === 'string' ? source : '';
  const imageUri = useProtectedImageUri(sourceUri, referer);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const canUseHeaders = Platform.OS !== 'web';
  useEffect(() => {
    setFailed(false);
    setNaturalSize({ width: 0, height: 0 });
    if (!imageUri) {
      setFailed(true);
      return;
    }
    const setMeasuredSize = (w, h) => {
      const nextSize = w > 0 && h > 0 ? { width: w, height: h } : { width: 0, height: 0 };
      setNaturalSize(nextSize);
      if (nextSize.width > 0 && nextSize.height > 0 && onSize) {
        onSize({ ...nextSize, uri: imageUri });
      }
    };
    if (imageUri.startsWith('file://') || imageUri.startsWith('content://')) {
      Image.getSize(imageUri, setMeasuredSize, () => setNaturalSize({ width: 0, height: 0 }));
    } else if (canUseHeaders && typeof Image.getSizeWithHeaders === 'function') {
      const headers = imageHeaders(referer, imageUri);
      Image.getSizeWithHeaders(
        imageUri,
        headers || {},
        setMeasuredSize,
        () => setNaturalSize({ width: 0, height: 0 })
      );
    } else {
      Image.getSize(imageUri, setMeasuredSize, () => setNaturalSize({ width: 0, height: 0 }));
    }
  }, [canUseHeaders, imageUri, onSize, referer]);
  const resolvedImageSource = imageSource(imageUri, referer);
  const hasNaturalSize = naturalSize.width > 0 && naturalSize.height > 0;
  const displayWidth = fit === 'width'
    ? width
    : nativePixelWidth(width, naturalSize.width, qualityMode);
  const displayHeight = hasNaturalSize
    ? naturalSize.height * (displayWidth / naturalSize.width)
    : 400;
  if (fit === 'contain') {
    const frameHeight = Math.max(260, windowHeight - topInset - bottomInset);
    const naturalWidthDp = hasNaturalSize ? naturalSize.width / DEVICE_PIXEL_RATIO : 0;
    const naturalHeightDp = hasNaturalSize ? naturalSize.height / DEVICE_PIXEL_RATIO : 0;
    const sharpScale = hasNaturalSize
      ? Math.min(1, width / naturalWidthDp, frameHeight / naturalHeightDp)
      : 1;
    const containWidth = qualityMode === 'sharp' && hasNaturalSize
      ? naturalWidthDp * sharpScale
      : width;
    const containHeight = qualityMode === 'sharp' && hasNaturalSize
      ? naturalHeightDp * sharpScale
      : frameHeight;
    return (
      <View style={[styles.containImageFrame, { width, minHeight: windowHeight, paddingTop: topInset, paddingBottom: bottomInset }]}>
        {!imageUri || failed ? (
          <ImageFallback height={frameHeight} width={width} />
        ) : (
          <FadeInImage
            imageKey={imageUri}
            source={resolvedImageSource}
            style={{ width: containWidth, height: containHeight }}
            resizeMode="contain"
            {...HIGH_QUALITY_IMAGE_PROPS}
            onError={() => setFailed(true)}
          />
        )}
      </View>
    );
  }
  if (!imageUri || failed) {
    return <ImageFallback height={300} width={width} />;
  }
  return (
    <View style={[styles.autoImageFrame, { width }]}>
      <FadeInImage
        imageKey={imageUri}
        source={resolvedImageSource}
        style={{ width: displayWidth, height: displayHeight }}
        resizeMode="contain"
        {...HIGH_QUALITY_IMAGE_PROPS}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

export function SourceSegment({ value, onChange }) {
  const scrollRef = useRef(null);
  const enabledSources = Platform.OS === 'web' ? WEB_SOURCE_ORDER : SOURCE_PICKER_ORDER;
  const sources = Platform.OS === 'web'
    ? [
        ...WEB_SOURCE_ORDER,
        ...SOURCE_PICKER_ORDER.filter((source) => !WEB_SOURCE_ORDER.includes(source)),
      ]
    : enabledSources;
  const activeIndex = Math.max(0, sources.indexOf(value));

  useEffect(() => {
    scrollRef.current?.scrollTo({
      x: Math.max(0, activeIndex * 116 - 24),
      animated: true,
    });
  }, [activeIndex]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sourceBarScroll}
      nestedScrollEnabled
    >
      {sources.map((s) => {
        const active = value === s;
        const disabled = !enabledSources.includes(s);
        const label = sourceShortLabel(s);
        return (
          <Pressable
            key={s}
            disabled={disabled}
            accessibilityState={{ selected: active, disabled }}
            onPress={() => onChange(s)}
            style={({ pressed }) => [
              styles.sourceChip,
              active && styles.sourceChipActive,
              disabled && styles.sourceChipDisabled,
              pressed && !active && styles.sourceChipPressed,
            ]}
          >
            {disabled ? (
              <Ionicons name="lock-closed-outline" size={12} color={THEME.textMuted} />
            ) : null}
            <Text
              style={[
                styles.sourceChipText,
                active && styles.sourceChipTextActive,
                disabled && styles.sourceChipTextDisabled,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function CatalogFilters({ source, value, onChange }) {
  const [open, setOpen] = useState(false);
  const groups = getCatalogFilterGroups(source);
  if (groups.length === 0) return null;

  const filters = sanitizeCatalogFilters(source, value);
  const defaultFilters = sanitizeCatalogFilters(source);
  const activeCount = countActiveCatalogFilters(source, filters);
  const activeLabels = groups
    .map((group) => {
      if (filters[group.key] === defaultFilters[group.key]) return null;
      return group.options.find((option) => option.key === filters[group.key])?.label;
    })
    .filter(Boolean);
  const summary = activeLabels.length > 0 ? activeLabels.join(' · ') : 'Default';
  const setFilter = (key, nextValue) => {
    onChange(sanitizeCatalogFilters(source, { ...filters, [key]: nextValue }));
  };

  return (
    <View style={styles.filterPanel}>
      <View style={styles.filterHeader}>
        <Pressable
          style={styles.filterToggle}
          onPress={() => setOpen((prev) => !prev)}
        >
          <View style={styles.filterToggleLeft}>
            <Ionicons name="options-outline" size={18} color={THEME.primary} />
            <View style={styles.filterTitleWrap}>
              <View style={styles.filterTitleRow}>
                <Text style={styles.filterToggleText}>Filters</Text>
                {activeCount > 0 ? (
                  <View style={styles.filterCountBadge}>
                    <Text style={styles.filterCountText}>{activeCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.filterSummaryText} numberOfLines={1}>{summary}</Text>
            </View>
          </View>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={THEME.textSecondary}
          />
        </Pressable>
        {activeCount > 0 ? (
          <Pressable
            accessibilityLabel="Reset filters"
            style={({ pressed }) => [
              styles.filterHeaderReset,
              pressed && styles.filterChipPressed,
            ]}
            onPress={() => onChange(sanitizeCatalogFilters(source))}
          >
            <Ionicons name="close-outline" size={17} color={THEME.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={styles.filterBody}>
          {groups.map((group) => (
            <View key={group.key} style={styles.filterGroup}>
              <Text style={styles.filterGroupLabel}>{group.label}</Text>
              <View style={styles.filterChipRow}>
                {group.options.map((option) => {
                  const active = filters[group.key] === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setFilter(group.key, option.key)}
                      style={({ pressed }) => [
                        styles.filterChip,
                        active && styles.filterChipActive,
                        pressed && styles.filterChipPressed,
                      ]}
                    >
                      {active ? (
                        <Ionicons name="checkmark" size={13} color={THEME.text} />
                      ) : null}
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <View style={styles.filterActions}>
            <Pressable
              style={({ pressed }) => [
                styles.filterReset,
                pressed && styles.filterChipPressed,
              ]}
              onPress={() => onChange(sanitizeCatalogFilters(source))}
            >
              <Ionicons name="close-circle-outline" size={15} color={THEME.textSecondary} />
              <Text style={styles.filterResetText}>Reset</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.filterDone,
                pressed && styles.filterChipPressed,
              ]}
              onPress={() => setOpen(false)}
            >
              <Text style={styles.filterDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }) {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name={icon} size={48} color={THEME.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function ScreenHeader({ title, subtitle }) {
  return (
    <View style={styles.screenHeader}>
      <Text style={styles.screenHeaderTitle}>{title}</Text>
      {subtitle ? <Text style={styles.screenHeaderSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function MangaCard({ item, onPress }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(140, (width - THEME.space.md * 3) / 2);
  const sourceImageUri = typeof item?.image === 'string' ? item.image : '';
  const itemUrl = typeof item?.url === 'string' ? item.url : '';
  const imageUri = useProtectedImageUri(sourceImageUri, itemUrl);
  const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled';
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  return (
    <TouchableOpacity style={[styles.card, { width: cardWidth }]} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.cardImageWrap}>
        {imageUri && !imageFailed ? (
          <Image
            source={imageSource(imageUri, itemUrl)}
            style={styles.image}
            {...HIGH_QUALITY_IMAGE_PROPS}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.image, styles.cardImageFallback]}>
            <Ionicons name="image-outline" size={28} color={THEME.textMuted} />
            <Text style={styles.cardImageFallbackText} numberOfLines={3}>
              {title}
            </Text>
          </View>
        )}
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>{sourceShortLabel(item?.source)}</Text>
        </View>
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sourceBarScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: THEME.space.lg,
    paddingBottom: THEME.space.md,
    flexGrow: 0,
  },
  sourceChip: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  sourceChipDisabled: {
    backgroundColor: THEME.surface,
    opacity: 0.72,
  },
  sourceChipText: { color: THEME.textSecondary, fontSize: 13, fontWeight: '600' },
  sourceChipTextActive: { color: THEME.text },
  sourceChipTextDisabled: { color: THEME.textMuted },
  filterPanel: {
    marginHorizontal: THEME.space.lg,
    marginBottom: THEME.space.md,
    backgroundColor: THEME.surfaceElevated,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: 'hidden',
  },
  filterHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  filterToggle: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.space.md,
  },
  filterToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterTitleWrap: {
    flexShrink: 1,
  },
  filterTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterToggleText: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: '700',
  },
  filterSummaryText: {
    color: THEME.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  filterHeaderReset: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: THEME.border,
  },
  filterCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: THEME.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.primaryDark,
    paddingHorizontal: 6,
  },
  filterCountText: {
    color: THEME.text,
    fontSize: 11,
    fontWeight: '800',
  },
  filterBody: {
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    paddingVertical: THEME.space.sm,
  },
  filterGroup: {
    marginBottom: THEME.space.md,
  },
  filterGroupLabel: {
    color: THEME.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: THEME.space.xs,
    paddingHorizontal: THEME.space.md,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    paddingRight: THEME.space.lg,
  },
  filterChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.pill,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  filterChipPressed: { opacity: 0.85 },
  filterChipActive: {
    backgroundColor: THEME.primaryDark,
    borderColor: THEME.primary,
  },
  filterChipText: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: THEME.text,
  },
  filterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: THEME.space.md,
    marginTop: THEME.space.sm,
    paddingTop: THEME.space.md,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  filterReset: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  filterResetText: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterDone: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: THEME.space.sm,
    paddingHorizontal: THEME.space.lg,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.primaryDark,
    borderWidth: 1,
    borderColor: THEME.primary,
  },
  filterDoneText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: '800',
  },
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
  screenHeader: {
    paddingHorizontal: THEME.space.lg,
    paddingTop: THEME.space.sm,
    paddingBottom: THEME.space.md,
  },
  screenHeaderTitle: {
    color: THEME.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0,
  },
  screenHeaderSubtitle: {
    color: THEME.textSecondary,
    fontSize: 14,
    marginTop: THEME.space.xs,
  },
  card: {
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
  cardImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: THEME.space.md,
  },
  cardImageFallbackText: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: THEME.space.sm,
    textAlign: 'center',
  },
  imageFallback: { backgroundColor: THEME.surface, alignItems: 'center', justifyContent: 'center' },
  imageFallbackText: { color: THEME.textMuted, fontSize: 12, marginTop: 8 },
  containImageFrame: {
    backgroundColor: '#000',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  autoImageFrame: {
    backgroundColor: '#000',
    alignItems: 'center',
  },
  sourceBadge: {
    position: 'absolute',
    bottom: THEME.space.sm,
    left: THEME.space.sm,
    backgroundColor: 'rgba(11,17,32,0.85)',
    paddingHorizontal: THEME.space.sm,
    paddingVertical: 4,
    borderRadius: THEME.radius.sm,
  },
  sourceBadgeText: { color: THEME.text, fontSize: 10, fontWeight: '700', letterSpacing: 0 },
  info: { padding: THEME.space.md },
  title: { color: THEME.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
});
