import type { ThemePreference } from "./theme-state";

export type AppliedTheme = "light" | "dark";

export type ThemeApplication = {
  setThemeSource(preference: ThemePreference): void;
  setBackgroundColor(color: string): void;
  persist(preference: ThemePreference): void;
};

/** Electron's nativeTheme: shouldUseDarkColors already honors the current themeSource. */
export type NativeThemeState = { readonly shouldUseDarkColors: boolean };

/** The live window side of a resolved theme: native background plus a one-way renderer push. */
export type ThemeWindow = {
  setBackgroundColor(color: string): void;
  sendResolvedTheme(theme: AppliedTheme): void;
};

export function backgroundColorForTheme(theme: AppliedTheme): string {
  return theme === "dark" ? "#0D0E10" : "#F6F7F8";
}

export function resolveThemePreference(preference: ThemePreference, systemIsDark: boolean): AppliedTheme {
  return preference === "system" ? systemIsDark ? "dark" : "light" : preference;
}

/**
 * Apply the native theme source and live color before the fallible startup-state write.
 * `systemIsDark` may be a getter so callers can read nativeTheme after the source changed.
 */
export function applyWindowTheme(
  preference: ThemePreference,
  systemIsDark: boolean | (() => boolean),
  lastPersistedPreference: ThemePreference | null,
  application: ThemeApplication
): ThemePreference | null {
  application.setThemeSource(preference);
  const theme = resolveThemePreference(preference, typeof systemIsDark === "function" ? systemIsDark() : systemIsDark);
  application.setBackgroundColor(backgroundColorForTheme(theme));
  if (preference === lastPersistedPreference) return lastPersistedPreference;
  application.persist(preference);
  return preference;
}

/** Resolve from nativeTheme regardless of preference and push it once to the live window. */
export function publishResolvedTheme(native: NativeThemeState, window: ThemeWindow | null): AppliedTheme {
  const theme: AppliedTheme = native.shouldUseDarkColors ? "dark" : "light";
  if (window) {
    window.setBackgroundColor(backgroundColorForTheme(theme));
    window.sendResolvedTheme(theme);
  }
  return theme;
}

/** Handle appearance:set-theme; the live theme is pushed even when persistence fails. */
export function applyThemePreference(
  preference: ThemePreference,
  native: NativeThemeState,
  lastPersistedPreference: ThemePreference | null,
  application: ThemeApplication,
  window: ThemeWindow | null
): ThemePreference | null {
  try {
    return applyWindowTheme(preference, () => native.shouldUseDarkColors, lastPersistedPreference, application);
  } finally {
    publishResolvedTheme(native, window);
  }
}
