const { readdir, rm } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const resources = platform === "darwin"
    ? join(context.appOutDir, "MM_LLM.app", "Contents", "Resources", "app.asar.unpacked", "node_modules")
    : join(context.appOutDir, "resources", "app.asar.unpacked", "node_modules");
  const arch = ({ "0": "ia32", "1": "x64", "2": "armv7l", "3": "arm64", "4": "universal" })[String(context.arch)];
  const keepCanvas = platform === "darwin" && ["arm64", "x64"].includes(arch)
    ? `canvas-darwin-${arch}`
    : platform === "win32" && arch === "x64" ? "canvas-win32-x64-msvc" : null;
  const napiRoot = join(resources, "@napi-rs");
  const canvasPackages = await readdir(napiRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all([
    ...canvasPackages.filter((entry) => entry.isDirectory() && entry.name.startsWith("canvas-") && entry.name !== keepCanvas)
      .map((entry) => rm(join(napiRoot, entry.name), { recursive: true, force: true })),
    // Build-time native helpers are never used by the bundled runtime.
    rm(join(resources, "@rollup"), { recursive: true, force: true }),
    rm(join(resources, "@esbuild"), { recursive: true, force: true })
  ]);
};
