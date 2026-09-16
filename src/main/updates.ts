import { app, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import electronUpdater from "electron-updater";
import type { UpdateState } from "../shared/contracts";

const { autoUpdater } = electronUpdater;
const enabled = app.isPackaged && (process.platform === "darwin" || process.platform === "win32") &&
  existsSync(join(process.resourcesPath, "app-update.yml"));
let state: UpdateState = {
  status: enabled ? "idle" : "disabled",
  currentVersion: app.getVersion()
};
let started = false;
let checking: Promise<UpdateState> | null = null;

function setState(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("updates:changed", state);
  }
}

export function currentUpdateState(): UpdateState { return state; }

export async function checkForUpdates(): Promise<UpdateState> {
  if (!enabled) return state;
  if (state.status === "ready" || state.status === "downloading") return state;
  if (checking) return checking;
  checking = (async () => {
    try {
      setState({ status: "checking", message: undefined });
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "업데이트 확인 실패" });
    } finally {
      checking = null;
    }
    return state;
  })();
  return checking;
}

export function installUpdate(): void {
  if (state.status !== "ready") throw new Error("설치할 업데이트가 아직 없습니다.");
  autoUpdater.quitAndInstall(false, true);
}

export function startUpdates(): void {
  if (!enabled || started) return;
  started = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => setState({ status: "checking" }));
  autoUpdater.on("update-available", (info) => setState({
    status: "downloading", availableVersion: info.version, progress: 0, message: undefined
  }));
  autoUpdater.on("update-not-available", () => setState({
    status: "latest", progress: undefined, availableVersion: undefined, message: undefined
  }));
  autoUpdater.on("download-progress", (progress) => setState({
    status: "downloading", progress: Math.round(progress.percent)
  }));
  autoUpdater.on("update-downloaded", (info) => setState({
    status: "ready", availableVersion: info.version, progress: 100
  }));
  autoUpdater.on("error", (error) => setState({ status: "error", message: error.message }));
  const initial = setTimeout(() => { void checkForUpdates(); }, 5_000);
  initial.unref();
  const recurring = setInterval(() => { void checkForUpdates(); }, 6 * 60 * 60 * 1_000);
  recurring.unref();
}
