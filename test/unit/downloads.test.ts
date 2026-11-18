import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDownloadsDirectory } from '../../src/main/shell/downloads-dir.ts';

test('ensureDownloadsDirectory creates missing custom directory and falls back when invalid', () => {
  const root = mkdtempSync(join(tmpdir(), 'anyu-dl-test-'));
  try {
    const custom = join(root, 'nested', 'downloads');
    const fallback = join(root, 'default-downloads');
    assert.equal(ensureDownloadsDirectory(custom, fallback), custom);
    assert.equal(statSync(custom).isDirectory(), true);

    const blockingFile = join(root, 'not-a-dir');
    writeFileSync(blockingFile, 'x');
    assert.equal(ensureDownloadsDirectory(blockingFile, fallback), fallback);
    assert.equal(statSync(fallback).isDirectory(), true);

    assert.throws(() => ensureDownloadsDirectory(blockingFile));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
