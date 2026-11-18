import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareVersions, isAllowedGithubReleaseUrl, parseVersion, pickLatestRelease } from '../../src/shared/updates.ts';
import { UpdateChecker } from '../../src/main/updater.ts';

describe('updates semver & release selection', () => {
  it('parses valid versions and rejects invalid ones', () => {
    assert.deepEqual(parseVersion('v0.5.0'), { major: 0, minor: 5, patch: 0, pre: [] });
    assert.deepEqual(parseVersion('0.1.0-beta.4'), { major: 0, minor: 1, patch: 0, pre: ['beta', '4'] });
    assert.equal(parseVersion('0.5.0-01'), null);
    assert.equal(parseVersion('not-a-version'), null);
  });

  it('orders stable and pre-release versions by SemVer precedence', () => {
    assert.equal(compareVersions('0.5.0', '0.1.0-beta.4'), 1);
    assert.equal(compareVersions('0.5.0', '0.5.0-beta.1'), 1);
    assert.equal(compareVersions('0.5.1-beta.1', '0.5.0'), 1);
    assert.equal(compareVersions('0.5.1-beta.10', '0.5.1-beta.2'), 1);
    assert.equal(compareVersions('0.5.1-rc.1', '0.5.1-beta.9'), 1);
    assert.equal(compareVersions('v0.5.0', '0.5.0'), 0);
  });

  it('validates allowed GitHub repository and release URLs', () => {
    assert.equal(isAllowedGithubReleaseUrl('https://github.com/5nix/anyu-browser'), true);
    assert.equal(isAllowedGithubReleaseUrl('https://github.com/5nix/anyu-browser/releases/tag/v0.5.0'), true);
    assert.equal(isAllowedGithubReleaseUrl('https://github.com/other/repo/releases/tag/v0.5.0'), false);
    assert.equal(isAllowedGithubReleaseUrl('http://github.com/5nix/anyu-browser/releases'), false);
  });

  it('picks the highest non-draft release across stable and pre-releases', () => {
    const releases = [
      { tag_name: 'v0.6.0-alpha.1', html_url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.6.0-alpha.1', draft: true, prerelease: true },
      { tag_name: 'v0.5.1-beta.2', html_url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.5.1-beta.2', draft: false, prerelease: true, published_at: '2026-11-19T00:00:00Z' },
      { tag_name: 'v0.5.0', html_url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.5.0', draft: false, prerelease: false },
      { tag_name: 'v0.9.0', html_url: 'https://evil.example.com/v0.9.0', draft: false, prerelease: false },
    ];
    const picked = pickLatestRelease(releases, '0.5.0');
    assert.deepEqual(picked, {
      version: '0.5.1-beta.2',
      tag: 'v0.5.1-beta.2',
      url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.5.1-beta.2',
      prerelease: true,
      publishedAt: '2026-11-19T00:00:00Z',
    });
    assert.equal(pickLatestRelease(releases, '0.5.1-beta.2'), null);
  });
});

describe('UpdateChecker routing & auto-check', () => {
  it('uses proxyFetch when gate is open and directFetch when gate is closed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-updater-'));
    try {
      let gateOpen = false;
      const calls: string[] = [];
      const checker = new UpdateChecker({
        currentVersion: '0.5.0',
        cacheFile: join(dir, 'update-check.json'),
        autoCheck: true,
        isGateOpen: () => gateOpen,
        proxyFetch: async () => {
          calls.push('proxy');
          return new Response(JSON.stringify([
            { tag_name: 'v0.5.1-beta.1', html_url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.5.1-beta.1', prerelease: true, draft: false },
          ]), { status: 200 });
        },
        directFetch: async () => {
          calls.push('direct');
          return new Response(JSON.stringify([
            { tag_name: 'v0.5.0', html_url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.5.0', prerelease: false, draft: false },
          ]), { status: 200 });
        },
        onChange: () => {},
      });

      const directState = await checker.checkNow();
      assert.deepEqual(calls, ['direct']);
      assert.equal(directState.status, 'latest');
      assert.equal(directState.via, 'direct');

      gateOpen = true;
      const proxyState = await checker.checkNow();
      assert.deepEqual(calls, ['direct', 'proxy']);
      assert.equal(proxyState.status, 'available');
      assert.equal(proxyState.via, 'proxy');
      assert.equal(proxyState.available?.tag, 'v0.5.1-beta.1');
      checker.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to direct auto-check after startup grace when gate does not open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-updater-grace-'));
    try {
      const calls: string[] = [];
      const checker = new UpdateChecker({
        currentVersion: '0.5.0',
        cacheFile: join(dir, 'update-check.json'),
        autoCheck: true,
        startupGraceMs: 20,
        isGateOpen: () => false,
        proxyFetch: async () => {
          calls.push('proxy');
          return new Response('[]', { status: 200 });
        },
        directFetch: async () => {
          calls.push('direct');
          return new Response('[]', { status: 200 });
        },
        onChange: () => {},
      });

      await checker.scheduleAutoCheck();
      await new Promise((r) => setTimeout(r, 60));
      assert.deepEqual(calls, ['direct']);
      assert.equal(checker.state.status, 'latest');
      checker.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses fresh cache during startup auto-check and skips stale or disabled checks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-updater-cache-'));
    try {
      const cacheFile = join(dir, 'update-check.json');
      const now = 1_700_000_000_000;
      writeFileSync(cacheFile, JSON.stringify({
        version: 1,
        currentVersion: '0.5.0',
        checkedAt: now - 1000,
        via: 'direct',
        available: {
          version: '0.5.1',
          tag: 'v0.5.1',
          url: 'https://github.com/5nix/anyu-browser/releases/tag/v0.5.1',
          prerelease: false,
          publishedAt: null,
        },
      }));
      let fetched = 0;
      const checker = new UpdateChecker({
        currentVersion: '0.5.0',
        cacheFile,
        autoCheck: true,
        now: () => now,
        isGateOpen: () => false,
        proxyFetch: async () => { fetched++; return new Response('[]', { status: 200 }); },
        directFetch: async () => { fetched++; return new Response('[]', { status: 200 }); },
        onChange: () => {},
      });

      await checker.scheduleAutoCheck();
      assert.equal(fetched, 0);
      assert.equal(checker.state.status, 'available');
      assert.equal(checker.state.available?.tag, 'v0.5.1');
      checker.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles HTTP rate limit and network errors cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-updater-err-'));
    try {
      const checker = new UpdateChecker({
        currentVersion: '0.5.0',
        cacheFile: join(dir, 'update-check.json'),
        autoCheck: false,
        isGateOpen: () => false,
        proxyFetch: async () => new Response('[]', { status: 200 }),
        directFetch: async () => new Response('rate limited', { status: 403 }),
        onChange: () => {},
      });
      const errState = await checker.checkNow();
      assert.equal(errState.status, 'error');
      assert.deepEqual(errState.error, { kind: 'rateLimit', status: 403 });
      checker.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
