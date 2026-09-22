import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

/** Checks actual bytes, not just filenames, before update metadata can be published. */
export async function verifyRelease(directory, platform, version) {
  if (!["mac", "win"].includes(platform)) throw new Error("Platform must be mac or win");
  const metadata = yaml.load(await readFile(join(directory, platform === "mac" ? "latest-mac.yml" : "latest.yml"), "utf8"));
  if (metadata?.version !== version || !Array.isArray(metadata.files) || !metadata.files.length) {
    throw new Error("Release version or file list does not match");
  }
  const seen = new Set();
  for (const file of metadata.files) {
    if (typeof file.url !== "string" || basename(file.url) !== file.url || /[\\/]/.test(file.url) || seen.has(file.url)) {
      throw new Error("Invalid or duplicate release filename");
    }
    seen.add(file.url);
    const path = join(directory, file.url);
    const details = await stat(path);
    if (!details.isFile() || !details.size || details.size !== file.size) throw new Error(`Incorrect size: ${file.url}`);
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest("base64") !== file.sha512) throw new Error(`Incorrect SHA512: ${file.url}`);
    if (!(await stat(`${path}.blockmap`)).size) throw new Error(`Missing blockmap: ${file.url}`);
  }
  if (platform === "win" && !seen.has(`MM_LLM-${version}-x64-Setup.exe`)) throw new Error("Missing Windows installer");
  if (platform === "mac") {
    for (const filename of [`MM_LLM-${version}-arm64-mac.zip`, `MM_LLM-${version}-mac.zip`,
      `MM_LLM-${version}-arm64.dmg`, `MM_LLM-${version}.dmg`]) {
      if (!seen.has(filename)) throw new Error(`Missing Mac artifact: ${filename}`);
    }
  }
  if (metadata.path && (!seen.has(metadata.path) || metadata.sha512 !== metadata.files.find((file) => file.url === metadata.path)?.sha512)) {
    throw new Error("Legacy update metadata does not match files");
  }
  return [...seen];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, directory = "release"] = process.argv.slice(2);
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const files = await verifyRelease(directory, platform, version);
  console.log(`Verified ${version}: ${files.join(", ")}`);
}
