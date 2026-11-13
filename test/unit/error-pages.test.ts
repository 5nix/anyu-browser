import { test } from 'node:test';
import assert from 'node:assert/strict';
import { certificateFailure, displayFailureUrl, failureKind } from '../../src/main/shell/recovery.ts';

test('classifies gate snapshot without claiming cause', () => {
  assert.equal(failureKind('open'), 'network');
  assert.equal(failureKind('closed'), 'gate');
  assert.equal(failureKind('checking'), 'gate');
});

test('redacts displayed URL', () => {
  assert.equal(displayFailureUrl('https://user:password@EXAMPLE.test/path?q=secret#fragment'), 'https://example.test/path');
  assert.equal(displayFailureUrl('https://example.test/'), 'https://example.test/');
  assert.equal(displayFailureUrl('invalid'), '');
  assert.equal(displayFailureUrl('file:///private/file'), '');
});

test('recognizes Chromium certificate errors', () => {
  for (const code of [-200, -201, -202, -219]) assert.equal(certificateFailure(code), true);
  for (const code of [-199, -220, -3, -105]) assert.equal(certificateFailure(code), false);
});

test('certificate exceptions are scoped to host and fingerprint', async () => {
  const { CertificateExceptions } = await import('../../src/main/shell/certificates.ts');
  const exceptions = new CertificateExceptions();
  exceptions.add('a.test', 'one');
  assert.equal(exceptions.has('a.test', 'one'), true);
  assert.equal(exceptions.hasHost('a.test'), true);
  assert.equal(exceptions.hasHost('b.test'), false);
  assert.equal(exceptions.has('a.test', 'two'), false);
  assert.equal(exceptions.has('b.test', 'one'), false);
  exceptions.clearHost('a.test');
  assert.equal(exceptions.has('a.test', 'one'), false);
  assert.equal(exceptions.hasHost('a.test'), false);
});
