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

const DEVICE_PIXEL_RATIO = Math.max(1, PixelRatio.get());
const PROTECTED_IMAGE_CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}imgcache/protected-images/`
  : null;
const protectedImageDownloads = new Map();
const HIGH_QUALITY_IMAGE_PROPS = Platform.OS === 'android'
  ? {
      resizeMethod: 'resize',
      resizeMultiplier: Math.min(2, DEVICE_PIXEL_RATIO),
      progressiveRenderingEnabled: false,
      fadeDuration: 0,
    }
  : {};
const SHARP_MAX_UPSCALE = 1.35;
const FULLSCREEN_SOFT_SOURCE_THRESHOLD = 0.94;
const FULLSCREEN_EDGE_FILL_MIN_RATIO = 0.8;
const FULLSCREEN_EDGE_FILL_UPSCALE = 1.12;
const IMAGE_DIMENSION_RANGE = 'bytes=0-65535';
const LOCAL_IMAGE_PROBE_LENGTH = 65536;
const GRID_MIN_CARD_WIDTH = 148;
const GRID_MAX_CARD_WIDTH = 196;
const SHELF_CARD_WIDTH = 136;

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

function ascii(bytes, start, end) {
  let text = '';
  for (let i = start; i < end && i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

function parseJpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return {
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
      };
    }
    if (!length || length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function parsePngSize(bytes) {
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes.length < 24
  ) {
    return null;
  }
  return {
    width: (bytes[16] << 24) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19],
    height: (bytes[20] << 24) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23],
  };
}

function parseWebpSize(bytes) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return null;
  const type = ascii(bytes, 12, 16);
  if (type === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (type === 'VP8 ' && bytes.length >= 30) {
    const start = 20;
    if (bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      return {
        width: (bytes[start + 6] | (bytes[start + 7] << 8)) & 0x3fff,
        height: (bytes[start + 8] | (bytes[start + 9] << 8)) & 0x3fff,
      };
    }
  }
  if (type === 'VP8L' && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

function parseImagePixelSize(bytes) {
  const size = parseJpegSize(bytes) || parsePngSize(bytes) || parseWebpSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}

function base64ToBytes(base64) {
  if (typeof atob !== 'function') return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function probeLocalImagePixelSize(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: LOCAL_IMAGE_PROBE_LENGTH,
  });
  const bytes = base64ToBytes(base64);
  return bytes ? parseImagePixelSize(bytes) : null;
}

async function probeImagePixelSize(uri, referer) {
  if (!uri || Platform.OS === 'web') return null;
  if (String(uri).startsWith('file://') || String(uri).startsWith('content://')) {
    return probeLocalImagePixelSize(uri);
  }
  const source = imageSource(uri, referer);
  if (!source) return null;
  const headers = {
    ...(source.headers || {}),
    Range: IMAGE_DIMENSION_RANGE,
  };
  const response = await fetch(source.uri, { headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return parseImagePixelSize(bytes);
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

function ImageFallback({ height = 300, width, onRetry }) {
  return (
    <View style={[styles.imageFallback, { width, height }]}>
      <Ionicons name="image-outline" size={32} color={THEME.textMuted} />
      <Text style={styles.imageFallbackText}>No image</Text>
      {onRetry ? (
        <Pressable style={styles.imageRetryButton} onPress={onRetry}>
          <Ionicons name="refresh-outline" size={14} color={THEME.text} />
          <Text style={styles.imageRetryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function nativePixelWidth(layoutWidth, naturalWidth, qualityMode) {
  if (qualityMode === 'original' && naturalWidth > 0) {
    return Math.max(1, Math.min(layoutWidth, naturalWidth / DEVICE_PIXEL_RATIO));
  }
  if (qualityMode === 'full') return layoutWidth;
  if (qualityMode !== 'sharp' || !naturalWidth || naturalWidth <= 0) return layoutWidth;
  return Math.max(1, Math.min(layoutWidth, (naturalWidth * SHARP_MAX_UPSCALE) / DEVICE_PIXEL_RATIO));
}

export function getGridColumnCount(width) {
  if (width < 330) return 1;
  if (width >= 1180) return 5;
  if (width >= 900) return 4;
  if (width >= 680) return 3;
  return 2;
}

function gridCardWidth(width, columns) {
  const columnCount = Math.max(1, columns || getGridColumnCount(width));
  const listPadding = THEME.space.sm * 2;
  const rowGaps = THEME.space.md * Math.max(0, columnCount - 1);
  const available = Math.max(0, width - listPadding - rowGaps);
  const rawWidth = available / columnCount;
  return Math.max(GRID_MIN_CARD_WIDTH, Math.min(GRID_MAX_CARD_WIDTH, rawWidth));
}

function isLikelyScaledImageSize(size) {
  return Platform.OS === 'android' && size?.width > 0 && size.width < 480;
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
  const [pixelSize, setPixelSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const canUseHeaders = Platform.OS !== 'web';
  const retryImage = () => {
    setFailed(false);
    setRetryVersion((value) => value + 1);
  };
  useEffect(() => {
    let active = true;
    setFailed(false);
    setNaturalSize({ width: 0, height: 0 });
    setPixelSize({ width: 0, height: 0 });
    if (!imageUri) {
      setFailed(true);
      return () => {
        active = false;
      };
    }
    let pixelProbeStarted = false;
    const publishNaturalSize = (nextSize) => {
      setNaturalSize(nextSize);
      if (nextSize.width > 0 && nextSize.height > 0 && onSize) {
        onSize({ ...nextSize, uri: imageUri });
      }
    };
    const probeUri = sourceUri && !sourceUri.startsWith('file://') && !sourceUri.startsWith('content://')
      ? sourceUri
      : imageUri;
    const startPixelProbe = (fallbackSize = null) => {
      if (pixelProbeStarted) return;
      pixelProbeStarted = true;
      probeImagePixelSize(probeUri, referer)
        .then((size) => (
          size || (imageUri !== probeUri ? probeImagePixelSize(imageUri, referer) : null)
        ))
        .then((size) => {
          if (!active) return;
          if (size) {
            setPixelSize(size);
            if (onSize) onSize({ ...size, uri: imageUri });
            return;
          }
          if (fallbackSize) publishNaturalSize(fallbackSize);
        })
        .catch(() => {
          if (active && fallbackSize) publishNaturalSize(fallbackSize);
        });
    };
    const setMeasuredSize = (w, h) => {
      if (!active) return;
      const nextSize = w > 0 && h > 0 ? { width: w, height: h } : { width: 0, height: 0 };
      if (isLikelyScaledImageSize(nextSize)) {
        startPixelProbe(nextSize);
        return;
      }
      publishNaturalSize(nextSize);
    };
    const clearMeasuredSize = () => {
      if (!active) return;
      setNaturalSize({ width: 0, height: 0 });
      startPixelProbe();
    };
    if (imageUri.startsWith('file://') || imageUri.startsWith('content://')) {
      Image.getSize(imageUri, setMeasuredSize, clearMeasuredSize);
    } else if (canUseHeaders && typeof Image.getSizeWithHeaders === 'function') {
      const headers = imageHeaders(referer, imageUri);
      Image.getSizeWithHeaders(
        imageUri,
        headers || {},
        setMeasuredSize,
        clearMeasuredSize
      );
    } else {
      Image.getSize(imageUri, setMeasuredSize, clearMeasuredSize);
    }
    return () => {
      active = false;
    };
  }, [canUseHeaders, imageUri, onSize, referer, retryVersion, sourceUri]);
  const resolvedImageSource = imageSource(imageUri, referer);
  const measuredSize = pixelSize.width > 0 && pixelSize.height > 0 ? pixelSize : naturalSize;
  const hasNaturalSize = measuredSize.width > 0 && measuredSize.height > 0;
  const displayWidth = fit === 'width'
    ? width
    : nativePixelWidth(width, measuredSize.width, qualityMode);
  const displayHeight = hasNaturalSize
    ? measuredSize.height * (displayWidth / measuredSize.width)
    : 400;
  if (fit === 'contain') {
    const frameHeight = Math.max(260, windowHeight - topInset - bottomInset);
    const naturalWidthDp = hasNaturalSize ? measuredSize.width / DEVICE_PIXEL_RATIO : 0;
    const naturalHeightDp = hasNaturalSize ? measuredSize.height / DEVICE_PIXEL_RATIO : 0;
    const naturalScale = hasNaturalSize
      ? Math.min(1, width / naturalWidthDp, frameHeight / naturalHeightDp)
      : 1;
    const containWidth = qualityMode !== 'full' && hasNaturalSize
      ? naturalWidthDp * naturalScale
      : width;
    const containHeight = qualityMode !== 'full' && hasNaturalSize
      ? naturalHeightDp * naturalScale
      : frameHeight;
    return (
      <View style={[styles.containImageFrame, { width, minHeight: windowHeight, paddingTop: topInset, paddingBottom: bottomInset }]}>
        {!imageUri || failed ? (
          <ImageFallback height={frameHeight} width={width} onRetry={imageUri ? retryImage : undefined} />
        ) : (
          <FadeInImage
            imageKey={`${imageUri}:${retryVersion}`}
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
    return <ImageFallback height={300} width={width} onRetry={imageUri ? retryImage : undefined} />;
  }
  const targetPhysicalWidth = width * DEVICE_PIXEL_RATIO;
  const isSoftFullscreenSource =
    fit === 'width' &&
    hasNaturalSize &&
    measuredSize.width < targetPhysicalWidth * FULLSCREEN_SOFT_SOURCE_THRESHOLD;
  if (isSoftFullscreenSource) {
    const sharpFillWidth = Math.min(
      width,
      Math.max(
        width * FULLSCREEN_EDGE_FILL_MIN_RATIO,
        (measuredSize.width * FULLSCREEN_EDGE_FILL_UPSCALE) / DEVICE_PIXEL_RATIO,
      ),
    );
    const sharpFillHeight = measuredSize.height * (sharpFillWidth / measuredSize.width);
    return (
      <View style={[styles.autoImageFrame, styles.smartFillFrame, { width, height: sharpFillHeight }]}>
        <FadeInImage
          imageKey={`${imageUri}:edge:${retryVersion}`}
          source={resolvedImageSource}
          style={[
            StyleSheet.absoluteFillObject,
            styles.smartFillBackground,
            { width, height: sharpFillHeight },
          ]}
          resizeMode="cover"
          blurRadius={Platform.OS === 'web' ? 0 : 12}
          {...HIGH_QUALITY_IMAGE_PROPS}
          onError={() => setFailed(true)}
        />
        <FadeInImage
          imageKey={`${imageUri}:sharp:${retryVersion}`}
          source={resolvedImageSource}
          style={{ width: sharpFillWidth, height: sharpFillHeight }}
          resizeMode="contain"
          {...HIGH_QUALITY_IMAGE_PROPS}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
  return (
    <View style={[styles.autoImageFrame, { width }]}>
      <FadeInImage
        imageKey={`${imageUri}:${retryVersion}`}
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
      style={styles.sourceBar}
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

export function CatalogFilters({ source, value, onChange, omitKeys = [] }) {
  const [open, setOpen] = useState(false);
  const omitted = new Set(omitKeys);
  const groups = getCatalogFilterGroups(source).filter((group) => !omitted.has(group.key));
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

export function MangaCard({ item, onPress, columns }) {
  const { width } = useWindowDimensions();
  const cardWidth = gridCardWidth(width, columns);
  const sourceImageUri = typeof item?.image === 'string' ? item.image : '';
  const itemUrl = typeof item?.url === 'string' ? item.url : '';
  const imageUri = useProtectedImageUri(sourceImageUri, itemUrl);
  const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled';
  const sourceCount = Number(item?.sourceCount) > 1 ? Number(item.sourceCount) : 1;
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
          <Text style={styles.sourceBadgeText}>
            {sourceShortLabel(item?.source)}{sourceCount > 1 ? ` +${sourceCount - 1}` : ''}
          </Text>
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

export function MangaShelfCard({ item, onPress, rank }) {
  const sourceImageUri = typeof item?.image === 'string' ? item.image : '';
  const itemUrl = typeof item?.url === 'string' ? item.url : '';
  const imageUri = useProtectedImageUri(sourceImageUri, itemUrl);
  const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled';
  const sourceCount = Number(item?.sourceCount) > 1 ? Number(item.sourceCount) : 1;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  return (
    <TouchableOpacity
      style={styles.shelfCard}
      activeOpacity={0.88}
      onPress={onPress}
    >
      <View style={styles.shelfImageWrap}>
        {imageUri && !imageFailed ? (
          <Image
            source={imageSource(imageUri, itemUrl)}
            style={styles.shelfImage}
            {...HIGH_QUALITY_IMAGE_PROPS}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.shelfImage, styles.cardImageFallback]}>
            <Ionicons name="image-outline" size={24} color={THEME.textMuted} />
            <Text style={styles.cardImageFallbackText} numberOfLines={3}>
              {title}
            </Text>
          </View>
        )}
        {Number.isFinite(rank) ? (
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>{rank}</Text>
          </View>
        ) : null}
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>
            {sourceShortLabel(item?.source)}{sourceCount > 1 ? ` +${sourceCount - 1}` : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.shelfTitle} numberOfLines={2}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sourceBar: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 50,
    maxHeight: 56,
  },
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
  imageRetryButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: THEME.space.md,
    paddingHorizontal: THEME.space.md,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.primaryDark,
  },
  imageRetryText: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: '700',
  },
  containImageFrame: {
    backgroundColor: '#05070A',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  autoImageFrame: {
    backgroundColor: '#05070A',
    alignItems: 'center',
  },
  smartFillFrame: {
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  smartFillBackground: {
    opacity: 0.34,
    transform: [{ scale: 1.08 }],
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
  shelfCard: {
    width: SHELF_CARD_WIDTH,
    marginRight: THEME.space.md,
  },
  shelfImageWrap: {
    width: SHELF_CARD_WIDTH,
    aspectRatio: 0.7,
    borderRadius: THEME.radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    position: 'relative',
  },
  shelfImage: {
    width: '100%',
    height: '100%',
    backgroundColor: THEME.surface,
  },
  shelfTitle: {
    color: THEME.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: THEME.space.sm,
  },
  rankBadge: {
    position: 'absolute',
    top: THEME.space.sm,
    left: THEME.space.sm,
    minWidth: 24,
    height: 24,
    borderRadius: THEME.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(37,99,235,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(147,197,253,0.42)',
  },
  rankBadgeText: {
    color: THEME.text,
    fontSize: 11,
    fontWeight: '800',
  },
});
