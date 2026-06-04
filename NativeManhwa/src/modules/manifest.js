export const MODULE_MANIFEST_VERSION = 1;

export const MODULE_FEATURES = {
  safeDiscovery: 'safeDiscovery',
  panelAdGuard: 'panelAdGuard',
  coverFallbacks: 'coverFallbacks',
  allIdQuickSearch: 'allIdQuickSearch',
  providerHealthPanel: 'providerHealthPanel',
  readerFloatingTools: 'readerFloatingTools',
  otaUpdateCenter: 'otaUpdateCenter',
};

export const OTA_CAPABILITIES = [
  {
    key: 'screens',
    label: 'Screen modules',
    description: 'Add or change JS screens, panels, rows, filters, and actions by OTA.',
  },
  {
    key: 'providers',
    label: 'Provider logic',
    description: 'Patch scraper rules, provider filters, and chapter parsing by OTA.',
  },
  {
    key: 'assets',
    label: 'Bundled assets',
    description: 'Ship small images, icons, and copy changes inside an OTA update.',
  },
  {
    key: 'runtime',
    label: 'Native-safe runtime',
    description: 'Blocks modules that declare native dependencies until a real app rebuild.',
  },
];

export const OTA_MODULES = [
  {
    id: 'safe-discovery',
    title: 'Safe discovery',
    summary: 'Filters adult titles from discovery, search, and quick picks.',
    category: 'Discovery',
    icon: 'shield-checkmark-outline',
    color: 'success',
    enabledByDefault: true,
    locked: true,
    requiresNative: false,
    surfaces: ['Home', 'Search', 'Scrapers'],
    features: [MODULE_FEATURES.safeDiscovery],
  },
  {
    id: 'panel-ad-guard',
    title: 'Panel ad guard',
    summary: 'Removes ad-like chapter images and keeps panel extraction focused on pages.',
    category: 'Reader',
    icon: 'ban-outline',
    color: 'warning',
    enabledByDefault: true,
    locked: true,
    requiresNative: false,
    surfaces: ['Reader', 'Scrapers'],
    features: [MODULE_FEATURES.panelAdGuard],
  },
  {
    id: 'cover-fallbacks',
    title: 'Cover fallbacks',
    summary: 'Uses multiple image fields so covers keep loading when providers change markup.',
    category: 'Discovery',
    icon: 'images-outline',
    color: 'primary',
    enabledByDefault: true,
    locked: true,
    requiresNative: false,
    surfaces: ['Home', 'Search', 'Details'],
    features: [MODULE_FEATURES.coverFallbacks],
  },
  {
    id: 'all-id-quick-picks',
    title: 'All ID quick picks',
    summary: 'Shows safe popular searches only when Semua Provider ID is selected.',
    category: 'Search',
    icon: 'flash-outline',
    color: 'primary',
    enabledByDefault: true,
    locked: false,
    requiresNative: false,
    surfaces: ['Search'],
    features: [MODULE_FEATURES.allIdQuickSearch],
    contributions: {
      quickSearches: [
        'The Greatest Estate Developer',
        'Eleceed',
        'Solo Leveling',
        'Lookism',
      ],
    },
  },
  {
    id: 'provider-health',
    title: 'Provider health',
    summary: 'Adds a Settings scanner for catalog, detail, chapter, and panel checks.',
    category: 'Diagnostics',
    icon: 'pulse-outline',
    color: 'primary',
    enabledByDefault: true,
    locked: false,
    requiresNative: false,
    surfaces: ['Settings', 'Scrapers'],
    features: [MODULE_FEATURES.providerHealthPanel],
  },
  {
    id: 'reader-panel-tools',
    title: 'Reader panel tools',
    summary: 'Adds jump-to-top and Full/Sharp/Original quality controls in the reader.',
    category: 'Reader',
    icon: 'scan-outline',
    color: 'success',
    enabledByDefault: true,
    locked: false,
    requiresNative: false,
    surfaces: ['Reader'],
    features: [MODULE_FEATURES.readerFloatingTools],
  },
  {
    id: 'ota-update-center',
    title: 'OTA update center',
    summary: 'Keeps update checks, update metadata, and module state editable by OTA.',
    category: 'Platform',
    icon: 'cloud-download-outline',
    color: 'success',
    enabledByDefault: true,
    locked: true,
    requiresNative: false,
    surfaces: ['Settings', 'Startup'],
    features: [MODULE_FEATURES.otaUpdateCenter],
  },
];

export function getDefaultModuleState() {
  const enabled = {};
  OTA_MODULES.forEach((module) => {
    enabled[module.id] = module.enabledByDefault !== false;
  });
  return {
    manifestVersion: MODULE_MANIFEST_VERSION,
    updatedAt: 0,
    enabled,
  };
}

export function getModuleById(moduleId) {
  return OTA_MODULES.find((module) => module.id === moduleId) || null;
}

export function moduleColor(theme, module) {
  if (!module || !theme) return undefined;
  if (module.color === 'success') return theme.success;
  if (module.color === 'warning') return theme.warning;
  if (module.color === 'danger') return theme.danger;
  return theme.primary;
}
