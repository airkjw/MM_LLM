import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { verifyRelease } from './verify-release.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG;
if (tag !== `v${version}` || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid release version');
const notes = `docs/RELEASE_NOTES_${tag}.md`;
await readFile(notes);
const mac = await verifyRelease('release', 'mac', version);
const win = await verifyRelease('release', 'win', version);
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// Listing avoids treating a network/authentication error as a missing release.
const releases = JSON.parse(gh('api', '--paginate', '--slurp', 'repos/airkjw/MM_LLM/releases')).flat();
const existing = releases.find((release) => release.tag_name === tag);
if (existing && !existing.draft) throw new Error('Release is already public; refusing to replace published artifacts');
if (!existing) gh('release', 'create', tag, '--repo', 'airkjw/MM_LLM', '--verify-tag', '--draft', '--title', `MM_LLM ${version}`, '--notes-file', notes);
const files = [...mac, ...win];
gh('release', 'upload', tag, '--repo', 'airkjw/MM_LLM', '--clobber',
  ...files.flatMap((file) => [`release/${file}`, `release/${file}.blockmap`]), 'release/latest-mac.yml', 'release/latest.yml');
const result = JSON.parse(gh('release', 'view', tag, '--repo', 'airkjw/MM_LLM', '--json', 'assets'));
const expected = [...files.flatMap((file) => [file, `${file}.blockmap`]), 'latest-mac.yml', 'latest.yml'];
if (expected.some((name) => !result.assets.some((asset) => asset.name === name && asset.size > 0))) throw new Error('Release upload is incomplete');
gh('release', 'edit', tag, '--repo', 'airkjw/MM_LLM', '--notes-file', notes, '--draft=false', '--latest');
console.log(`Published MM_LLM ${version} with macOS/Windows artifacts and release notes.`);
