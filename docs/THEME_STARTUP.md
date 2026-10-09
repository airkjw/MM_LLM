# Startup theme synchronization

MM_LLM stores only the theme preference (`system`, `light`, or `dark`) in `appearance.json` under Electron's user-data directory. It contains no account or API-key data and is intentionally kept when the user logs out. The main process alone resolves the preference to a light or dark appearance through Electron's `nativeTheme`; the renderer never reads the operating-system color scheme (no `prefers-color-scheme` in CSS or `matchMedia` in renderer code).

## Startup order

1. In `app.whenReady`, before any window exists, the main process reads at most 128 bytes from `appearance.json`. A missing, oversized, malformed, or extended record counts as no preference. It then sets `nativeTheme.themeSource` to the stored preference, or `system` when there is none.
2. `createWindow()` derives the initial theme from `nativeTheme.shouldUseDarkColors`, which already honors the forced source. That value sets `BrowserWindow.backgroundColor` (`#0D0E10` dark, `#F6F7F8` light) and is forwarded as the whitelisted `--mmllm-initial-theme` `additionalArguments` value.
3. The sandboxed preload validates that argument and exposes only the non-sensitive `mmllmBootstrap.initialTheme` field through `contextBridge`.
4. A blocking, self-hosted script in the document head applies `document.documentElement.dataset.theme` from that bootstrap value before the body is parsed and before the first renderer frame.

This follows Electron's isolated preload bridge model without weakening CSP, sandboxing, context isolation, or navigation restrictions.

## Live updates (one-way push)

After startup, `data-theme` changes only through the main → renderer channel `appearance:resolved`; there is no renderer → main counterpart.

- On every `nativeTheme` `updated` event, the main process resolves `shouldUseDarkColors` to `light` or `dark` regardless of the stored preference, sets the window background, and sends the value to the live window.
- `appearance:set-theme` (invoked by the renderer when the saved setting changes) validates the preference, sets `nativeTheme.themeSource` and the background, persists the preference, and finally pushes the resolved value once, also when persistence fails. Changing `themeSource` can itself emit `updated`, so one request may push the same value twice; the renderer ignores repeated values.
- The preload's `onThemeResolved` forwards only the literals `light` and `dark`, ignores anything else, and returns an unsubscribe function. The renderer writes `data-theme` only when the pushed value differs and sends nothing back, so a push cannot start a feedback loop. Theme changes do not remount the React tree, so focus, open popovers, and drafts are preserved.

## Persistence

When settings load, the renderer writes `data-theme-preference` and syncs the saved preference to the main process once; later syncs happen only when the preference changes, and a failed sync is retried for the same value. The main process writes `appearance.json` only when the preference differs from the persisted value, including the first run where no value exists, so repeated system-theme notifications never rewrite the file. Writes use a same-directory temporary file, owner-only permissions where supported, and atomic rename. Failed persistence is logged without exposing user data; the renderer reports a safe diagnostic, the live theme still applies, and the previous complete record remains usable.
