# OTA modules

This folder defines WibuNgomik features that can be changed through Expo OTA updates.

Rules:

- A module may add JavaScript screens, settings rows, scraper rules, filters, copy, or bundled assets.
- A module must set `requiresNative: false` to be OTA-safe.
- A module must not import a new native dependency unless the app version/runtime is rebuilt.
- User-facing modules should expose a stable `id`, `title`, `summary`, `surfaces`, and `features`.
- Core safety modules can use `locked: true` so users cannot disable required behavior.

Add a module by editing `manifest.js`, then wire its `features` or `contributions` through
`src/services/moduleRuntime.js`. Run `npm run audit:modules` before publishing an OTA update.
