import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { encryptBackup, decryptBackup } from '../src/main/backup-crypto.ts';

let root; let machine = 'first-machine';
globalThis.__mmllmStorageElectron = {
  app: { getPath: () => root },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`${machine}\0${value}`),
    decryptStringAsync: async (bytes) => {
      const value = bytes.toString();
      if (!value.startsWith(`${machine}\0`)) throw new Error('wrong machine keychain');
      return { result: value.slice(machine.length + 1), shouldReEncrypt: false };
    }
  }
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: 'mmllm-test:electron', shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/')) {
      const url = new URL(specifier, context.parentURL);
      if (url.protocol === 'file:' && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + '.ts')) {
        return next(url.href + '.ts', context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'mmllm-test:electron') return { format: 'module', source: 'export const { app, safeStorage } = globalThis.__mmllmStorageElectron;', shortCircuit: true };
    return next(url, context);
  }
});

test('actual storage backup restores documents and settings on a different machine without transferring the API key', async () => {
  const first = await mkdtemp(join(tmpdir(), 'mmllm-backup-source-'));
  const second = await mkdtemp(join(tmpdir(), 'mmllm-backup-destination-'));
  root = first;
  try {
    const storage = await import('../src/main/storage.ts');
    const vault = await import('../src/main/project-vault.ts');
    await storage.activateProfileForKey('PRIVATE-API-KEY-SOURCE'); await storage.saveKey('PRIVATE-API-KEY-SOURCE');
    const project = await vault.createProject(storage.getActiveProfileId(), '연구', '정확히 분석');
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('통계').addRow(['환자 수', 10]);
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    await vault.addProjectDocument(storage.getActiveProfileId(), project.id, { name: 'sample.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: content });
    const thread = await storage.createThread({ modelId: 'gpt-5.6-sol', projectId: project.id });
    await storage.updateThread(thread.id, (value) => {
      value.attachmentConsent = true;
      value.messages.push({ id: 'answer', role: 'assistant', modelId: 'gpt-5.6-sol', text: '연구 답변', apiContent: '연구 답변', createdAt: new Date().toISOString(),
        webSearch: { route: 'native', provider: 'gemini', status: 'executed', queries: ['synthetic public query'],
          citations: [{ url: 'https://example.test/public-statistic', title: 'synthetic' }], requestCount: 1 } });
      value.messages.push({ id: 'paused', role: 'assistant', modelId: 'claude-sonnet-5', text: '합성 부분 답변', apiContent: '합성 부분 답변',
        createdAt: new Date().toISOString(), status: 'incomplete', continuationUnsupportedReason: 'claude_pause_turn',
        webSearch: { route: 'native', provider: 'claude', status: 'executed', queries: ['synthetic query'],
          citations: [{ url: 'https://example.test/public-statistic', title: 'synthetic' }] } });
      value.messages.push({ id: 'invalid-reason', role: 'assistant', text: '합성', apiContent: '합성', createdAt: new Date().toISOString(),
        continuationUnsupportedReason: { encrypted_content: 'synthetic-invalid-state' } });
    });
    await storage.saveSettings({ defaultInstruction: '연구 설정', theme: 'dark', fontSize: 'large' });
    const staleSettings = await storage.loadSettings();
    await Promise.all([
      storage.updateModelPreference('gpt-5.6-sol', 'favorite'),
      storage.updateModelPreference('gpt-5.6-sol', 'recent'),
      storage.saveSettings(staleSettings)
    ]);
    assert.deepEqual((await storage.loadSettings()).favoriteModels, ['gpt-5.6-sol']);
    assert.deepEqual((await storage.loadSettings()).recentModels, ['gpt-5.6-sol']);
    const portable = await storage.exportPortableBackup();
    assert.equal(JSON.stringify(portable).includes('PRIVATE-API-KEY-SOURCE'), false);
    const encrypted = await encryptBackup(Buffer.from(JSON.stringify(portable)), 'backup-test-password');
    root = second; machine = 'second-machine'; storage.clearActiveProfile();
    await storage.activateProfileForKey('DESTINATION-KEY'); await storage.saveKey('DESTINATION-KEY');
    const old = await storage.createThread({ modelId: 'gpt-5.6-luna' });
    const oldProfile = storage.getActiveProfileId();
    const encrypt = globalThis.__mmllmStorageElectron.safeStorage.encryptStringAsync;
    let writes = 0;
    globalThis.__mmllmStorageElectron.safeStorage.encryptStringAsync = async (value) => {
      if (++writes === 2) throw new Error('simulated disk failure while staging settings');
      return encrypt(value);
    };
    await assert.rejects(storage.restorePortableBackup(portable), /simulated disk failure/);
    assert.equal(storage.getActiveProfileId(), oldProfile);
    assert.equal((await storage.getThread(old.id)).id, old.id);
    globalThis.__mmllmStorageElectron.safeStorage.encryptStringAsync = encrypt;
    await storage.restorePortableBackup(JSON.parse((await decryptBackup(encrypted, 'backup-test-password')).toString()));
    const restoredProfileForSearch = storage.getActiveProfileId();
    assert.notEqual(storage.getActiveProfileId(), oldProfile);
    assert.equal(await storage.loadKey(), 'DESTINATION-KEY');
    assert.equal((await storage.getThread(thread.id)).attachmentConsent, false);
    assert.equal((await storage.getThread(thread.id)).messages[0].modelId, 'gpt-5.6-sol');
    assert.equal(storage.snapshot(await storage.getThread(thread.id)).messages[0].webSearch.citations[0].url, 'https://example.test/public-statistic');
    assert.equal((await storage.getThread(thread.id)).messages[0].webSearch.status, 'executed');
    const publicMessages = storage.snapshot(await storage.getThread(thread.id)).messages;
    assert.equal(publicMessages[0].webSearch.requestCount, undefined, 'legacy unverified Gemini count is stripped');
    assert.equal(publicMessages[1].status, 'incomplete');
    assert.equal(publicMessages[1].continuationUnsupportedReason, 'claude_pause_turn');
    assert.equal(publicMessages[1].text, '합성 부분 답변');
    assert.equal(publicMessages[1].webSearch.citations.length, 1);
    assert.equal(publicMessages[2].continuationUnsupportedReason, undefined);
    assert.doesNotMatch(JSON.stringify(publicMessages), /synthetic-invalid-state/);
    const { serializeThreadMarkdown } = await import('../src/shared/thread-export.ts');
    const exported = serializeThreadMarkdown(storage.snapshot(await storage.getThread(thread.id)));
    assert.match(exported, /이어 생성은 지원하지 않습니다.*별도 요청으로 추가 과금/);
    assert.match(exported, /합성 부분 답변/);
    await storage.activateProfileForKey('SYNTHETIC-OTHER-PROFILE');
    await assert.rejects(storage.getThread(thread.id), /찾/);
    await storage.activateProfileForKey('DESTINATION-KEY');
    // Restore created a replacement profile bound to the destination key.
    assert.equal(storage.getActiveProfileId(), restoredProfileForSearch);
    assert.equal((await storage.loadSettings()).defaultInstruction, '연구 설정');
    assert.deepEqual(Buffer.from((await storage.exportPortableBackup()).projects[0].documents[0].content, 'base64'), content);
    assert.ok((await readdir(join(second, 'private'))).includes(`threads-profile-${oldProfile}.enc`), 'previous records remain recoverable');
    const restoredProfile = storage.getActiveProfileId();
    assert.throws(() => storage.restorePortableBackup({ ...portable, projects: [{ ...portable.projects[0], id: '../../escape' }] }));
    assert.equal(storage.getActiveProfileId(), restoredProfile);
    await assert.rejects(storage.getThread(old.id));
  } finally {
    hooks.deregister(); delete globalThis.__mmllmStorageElectron;
    await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true });
  }
});
