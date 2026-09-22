import type { ThemePreference } from "./theme-state";

export type AppliedTheme = "light" | "dark";

export type ThemeApplication = {
  setBackgroundColor(color: string): void;
  persist(preference: ThemePreference): void;
};

export function backgroundColorForTheme(theme: AppliedTheme): string {
  return theme === "dark" ? "#12161D" : "#FFFFFF";
}

export function resolveThemePreference(preference: ThemePreference, systemIsDark: boolean): AppliedTheme {
  return preference === "system" ? systemIsDark ? "dark" : "light" : preference;
}

/** Apply the live native color before the fallible startup-state write. */
export function applyWindowTheme(
  preference: ThemePreference,
  systemIsDark: boolean,
  lastPersistedPreference: ThemePreference | null,
  application: ThemeApplication
): ThemePreference | null {
  const theme = resolveThemePreference(preference, systemIsDark);
  application.setBackgroundColor(backgroundColorForTheme(theme));
  if (preference === lastPersistedPreference) return lastPersistedPreference;
  application.persist(preference);
  return preference;
}
