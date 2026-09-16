import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";

const projectRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("package.json", projectRoot), "utf8"));
const version = packageJson.version;
const releaseDir = new URL("release/", projectRoot);
const artifactNames = [
  `MM_LLM-${version}-mac.zip`,
  `MM_LLM-${version}-arm64-mac.zip`,
  `MM_LLM-${version}.dmg`,
  `MM_LLM-${version}-arm64.dmg`
];

const files = artifactNames.map((url) => {
  const fileUrl = new URL(url, releaseDir);
  const bytes = readFileSync(fileUrl);
  return {
    url,
    sha512: createHash("sha512").update(bytes).digest("base64"),
    size: statSync(fileUrl).size
  };
});

const metadata = {
  version,
  files,
  path: files[0].url,
  sha512: files[0].sha512,
  releaseDate: new Date().toISOString()
};

writeFileSync(new URL("latest-mac.yml", releaseDir), yaml.dump(metadata, { lineWidth: -1 }));
