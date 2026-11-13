import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordInPageVisit, allowedSiteOrigin, NavigationFailures, PDF_VIEWER_ORIGIN, isAllowedPdfViewerFrame } from '../../src/shared/navigation-safety.ts';

test('in-page history records path and query changes, not fragment-only changes', () => {
  assert.equal(recordInPageVisit('https://a.test/p#one', 'https://a.test/p#two'), false);
  assert.equal(recordInPageVisit('https://a.test/p', 'https://a.test/q'), true);
  assert.equal(recordInPageVisit('https://a.test/p', 'https://a.test/p?q=1'), true);
});

test('site clearing is restricted to web origins belonging to the window', () => {
  assert.equal(allowedSiteOrigin('https://a.test/path', ['https://a.test/other']), 'https://a.test');
  assert.equal(allowedSiteOrigin('https://b.test', ['https://a.test']), null);
  assert.equal(allowedSiteOrigin('file:///tmp/x', ['file:///tmp/x']), null);
  assert.equal(allowedSiteOrigin('invalid', []), null);
});

test('older failures cannot replace the current navigation error', () => {
  const nav = new NavigationFailures();
  nav.start('https://a.test'); nav.start('https://b.test');
  assert.equal(nav.accepts('https://a.test'), false);
  assert.equal(nav.accepts('https://b.test'), true);
  nav.start('https://b.test');
  assert.equal(nav.accepts('https://b.test'), true);
});

test('built-in PDF viewer stream frame is allowed only from within the PDF viewer itself', () => {
  const stream = `${PDF_VIEWER_ORIGIN}/00000000-0000-0000-0000-000000000001`;
  assert.equal(isAllowedPdfViewerFrame(stream, false, PDF_VIEWER_ORIGIN, PDF_VIEWER_ORIGIN), true);
  assert.equal(isAllowedPdfViewerFrame(stream, true, PDF_VIEWER_ORIGIN, PDF_VIEWER_ORIGIN), false);
  assert.equal(isAllowedPdfViewerFrame(stream, false, 'https://example.test', PDF_VIEWER_ORIGIN), false);
  assert.equal(isAllowedPdfViewerFrame(stream, false, PDF_VIEWER_ORIGIN, 'https://example.test'), false);
  assert.equal(isAllowedPdfViewerFrame('chrome-extension://other/index.html', false, PDF_VIEWER_ORIGIN, PDF_VIEWER_ORIGIN), false);
});

