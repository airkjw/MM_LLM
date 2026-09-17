import type { AppliedTheme } from "./theme-state";

export type ThemeApplication = {
  setBackgroundColor(color: string): void;
  persist(theme: AppliedTheme): void;
};

export function backgroundColorForTheme(theme: AppliedTheme): string {
  return theme === "dark" ? "#18171C" : "#FFFFFF";
}

/** Apply the live native color before the fallible startup-state write. */
export function applyWindowTheme(
  theme: AppliedTheme,
  lastPersistedTheme: AppliedTheme | null,
  application: ThemeApplication
): AppliedTheme | null {
  application.setBackgroundColor(backgroundColorForTheme(theme));
  if (theme === lastPersistedTheme) return lastPersistedTheme;
  application.persist(theme);
  return theme;
}
