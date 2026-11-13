import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { pageMenu, tabMenu, toolbarMenu, validWeb } from '../../src/main/shell/context-menu.ts';

const flags = { canUndo: false, canRedo: true, canCut: false, canCopy: true, canPaste: false, canSelectAll: true };
const params = (extra: object = {}) => ({ linkURL: '', srcURL: '', mediaType: 'none', isEditable: false, selectionText: '', editFlags: flags, ...extra }) as Electron.ContextMenuParams;
const ids = (items: ReturnType<typeof pageMenu>) => items.map(i => 'separator' in i ? '|' : i.id);
const enabled = (items: ReturnType<typeof pageMenu>, id: string) => items.find(i => !('separator' in i) && i.id === id && i.enabled);

test('page menu combines groups and respects permissions', () => {
  assert.deepEqual(ids(pageMenu(params(), false, true, false)), ['page.back', 'page.forward', 'page.reload', '|', 'inspect']);
  const menu = pageMenu(params({ linkURL: 'javascript:alert(1)', mediaType: 'image', srcURL: 'https://example.com/a', selectionText: 'selected' }), true, false, false);
  assert.deepEqual(ids(menu), ['openLink', 'copyLink', '|', 'openImage', 'copyImage', 'saveImage', '|', 'copy', '|', 'page.back', 'page.forward', 'page.reload', '|', 'inspect']);
  assert.equal(enabled(menu, 'openLink'), undefined); assert.equal(enabled(menu, 'saveImage'), undefined);
  assert.ok(enabled(menu, 'openImage')); assert.ok(enabled(menu, 'copy'));
  assert.ok(enabled(pageMenu(params({ mediaType: 'image', srcURL: 'https://example.com/a' }), false, false, true), 'saveImage'));
});
test('editable flags, tab and toolbar availability', () => {
  const menu = pageMenu(params({ isEditable: true }), false, false, true);
  assert.equal(enabled(menu, 'undo'), undefined); assert.ok(enabled(menu, 'redo')); assert.ok(enabled(menu, 'selectAll'));
  assert.equal(enabled(tabMenu(false), 'page.reload'), undefined); assert.ok(enabled(tabMenu(false), 'tab.close'));
  assert.equal(enabled(toolbarMenu(false), 'zoom.in'), undefined); assert.ok(enabled(toolbarMenu(false), 'downloads.open'));
});
test('web URL validation limits length and rejects privileged schemes', () => {
  for (const value of ['file:///tmp/a', 'javascript:alert(1)', 'https://' + 'a'.repeat(8192), '', null]) assert.equal(validWeb(value), false);
  assert.equal(validWeb('https://example.com/'), true);
});
