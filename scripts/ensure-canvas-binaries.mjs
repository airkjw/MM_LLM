import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const target = process.argv[2];
const packages = target === "mac"
  ? ["@napi-rs/canvas-darwin-arm64@1.0.9", "@napi-rs/canvas-darwin-x64@1.0.9"]
  : target === "win" ? ["@napi-rs/canvas-win32-x64-msvc@1.0.9"] : [];
if (!packages.length) throw new Error("대상은 mac 또는 win이어야 합니다.");

for (const spec of packages) {
  const name = spec.slice(0, spec.lastIndexOf("@"));
  const destination = join(process.cwd(), "node_modules", ...name.split("/"));
  if (existsSync(join(destination, "package.json"))) continue;
  const temp = mkdtempSync(join(tmpdir(), "mmllm-native-"));
  const packed = execFileSync("npm", ["pack", spec, "--silent", "--pack-destination", temp], { encoding: "utf8" }).trim();
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", join(temp, basename(packed)), "-C", destination, "--strip-components=1"]);
}
