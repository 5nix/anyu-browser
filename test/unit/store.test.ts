// Exercises the local store and its repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, migrations, Prefs, History, Bookmarks, Sessions, SiteSettings, Downloads, clearBrowsingData } from '../../src/main/store/index.ts';

test('migration, persistence and damaged files', () => {
  const dir = mkdtempSync(join(tmpdir(),'cave-store-')); const file = join(dir,'store.db');
  try {
    let store = openStore(file); assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version,4); new Prefs(store).set('a',42); store.close();
    store = openStore(file); assert.equal(new Prefs(store).get('a',0),42); store.close();
    writeFileSync(file,'garbage'); store = openStore(file); assert.ok(store.recovered && existsSync(store.recovered)); store.close();
    const db = new DatabaseSync(file); db.exec('PRAGMA user_version=999'); db.close();
    assert.throws(() => openStore(file), /Unknown database version/);
    const old = join(dir, 'old.db'); const oldDb = new DatabaseSync(old); oldDb.exec('PRAGMA user_version=0'); oldDb.close();
    store = openStore(old); assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version,4); store.close();
  } finally { rmSync(dir,{ recursive:true, force:true }); }
});

test('repositories and browsing data', () => {
  const store = openStore(':memory:');
  try {
    const prefs = new Prefs(store); prefs.set('x',{ a:1 }); assert.deepEqual(prefs.get('x',{}),{ a:1 }); store.db.prepare('INSERT INTO prefs VALUES (?,?)').run('bad','{'); assert.equal(prefs.get('bad',7),7);
    const history = new History(store); history.visit('https://example.com','Example',true,1); history.visit('https://example.com','Example',true,2); history.visit('https://example.org','Example',false,3); assert.equal(history.recent(5)[1].visits,2); assert.equal(history.search('example',5)[0].url,'https://example.com'); for (const text of ['"', '*', 'OR', 'NEAR', '中文', '']) assert.doesNotThrow(() => history.search(text,10));
    history.setTitle('https://example.org','Renamed'); assert.equal(history.search('renamed',5)[0].url, 'https://example.org'); assert.equal(history.search('Example',5).length,2); history.removeRange(3,3); assert.equal(history.search('renamed',5).length,0); history.remove('https://example.com'); assert.equal(history.search('example',5).length,0); history.visit('https://example.com','Again',false,4);
    const bookmarks = new Bookmarks(store); const folder = bookmarks.add({ parent:null,kind:'folder',title:'folder' }); const a = bookmarks.add({ parent:null,kind:'link',title:'a',url:'a' }); const b = bookmarks.add({ parent:null,kind:'link',title:'b',url:'b' }); bookmarks.move(b,null,0); assert.deepEqual(bookmarks.children(null).map(x => x.id),[b,folder,a]); bookmarks.move(a,folder,0); assert.equal(bookmarks.children(folder)[0].id,a); bookmarks.move(a,null,2); assert.equal(bookmarks.find('a')[0].id,a); assert.equal(bookmarks.search('a',10)[0].id,a); bookmarks.remove(folder); assert.deepEqual(bookmarks.children(null).map(x => x.position),[0,1]); const nested = bookmarks.add({ parent:null,kind:'folder',title:'nested' }); const child = bookmarks.add({ parent:nested,kind:'folder',title:'child' }); assert.throws(() => bookmarks.move(nested,child,0)); assert.throws(() => bookmarks.move(nested,nested,0));
    const sessions = new Sessions(store); for (let i=0;i<30;i++) sessions.pushClosed(i); for (let i=29;i>=5;i--) assert.equal(sessions.popClosed(),i); assert.equal(sessions.popClosed(),null); sessions.save({ tabs:[] }); assert.deepEqual(sessions.latest(),{ tabs:[] }); sessions.pushClosed('clear me');
    const settings = new SiteSettings(store); settings.set('https://a','zoom',1.5); assert.equal(settings.get('https://a','zoom',1),1.5); assert.equal(settings.all('https://a').zoom,1.5); settings.delete('https://a','zoom'); settings.set('https://a','zoom',2);
    const downloads = new Downloads(store); const download = downloads.insert({ url:'u',path:'p',name:'n',state:'progressing',started:1 }); downloads.update(download,{ state:'done', ended:2 }); assert.equal(downloads.list(1)[0].state,'done'); const other = downloads.insert({ url:'v',path:'q',name:'m',state:'done',started:2 }); downloads.remove(other); assert.equal(downloads.list(10).length,1); clearBrowsingData(store); assert.equal(history.recent(10).length,0); assert.equal(sessions.latest(),null); assert.equal(sessions.popClosed(),null); assert.equal(new Downloads(store).list(10).length,0); assert.equal(settings.get('https://a','zoom',0),0); assert.deepEqual(prefs.get('x',{}),{ a:1 }); assert.ok(bookmarks.children(null).length);
  } finally { store.close(); }
});

test('unfinished downloads are persistently interrupted on startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-downloads-')); const file = join(dir, 'store.db');
  try {
    let store = openStore(file); let downloads = new Downloads(store);
    downloads.insert({ url: 'u', path: 'p', name: 'n', state: 'progressing', started: 1 });
    downloads.insert({ url: 'v', path: 'q', name: 'm', state: 'completed', started: 2 });
    downloads.interruptUnfinished(); store.close();
    store = openStore(file); downloads = new Downloads(store);
    assert.deepEqual(downloads.list(10).map(d => d.state), ['completed', 'interrupted']); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('site zoom validates values and removes defaults without disturbing other settings', () => {
  const store = openStore(':memory:');
  try {
    const settings = new SiteSettings(store);
    assert.equal(settings.getZoom('https://a'), 100);
    settings.set('https://a', 'permission', 'allow');
    settings.set('https://a', 'zoom', 1.5);
    assert.equal(settings.getZoom('https://a'), 100);
    store.prepare('UPDATE site_settings SET value=? WHERE origin=? AND key=?').run('{', 'https://a', 'zoom');
    assert.equal(settings.getZoom('https://a'), 100);
    assert.throws(() => settings.setZoom('https://a', NaN));
    settings.setZoom('https://a', 125); assert.equal(settings.getZoom('https://a'), 125);
    settings.setZoom('https://a', 100); assert.equal(settings.get('https://a', 'zoom', null), null);
    assert.equal(settings.get('https://a', 'permission', null), 'allow');
    store.close();
    assert.throws(() => settings.setZoom('https://a', 110));
    assert.equal(settings.getZoom('https://a'), 100);
  } finally { try { store.close(); } catch {} }
});

test('permission decisions are atomic, validated and cleared by origin', () => {
  const store = openStore(':memory:');
  try {
    const settings = new SiteSettings(store);
    settings.setPermissions('https://a', ['media-camera', 'media-microphone'], 'allow');
    assert.equal(settings.getPermission('https://a', 'media-camera'), 'allow');
    settings.set('https://a', 'permission:notifications', 'invalid');
    assert.equal(settings.getPermission('https://a', 'notifications'), null);
    store.db.exec("CREATE TRIGGER reject_permission BEFORE INSERT ON site_settings WHEN NEW.key='permission:geolocation' BEGIN SELECT RAISE(ABORT, 'failure'); END");
    assert.throws(() => settings.setPermissions('https://b', ['media-camera', 'geolocation'], 'deny'));
    assert.equal(settings.getPermission('https://b', 'media-camera'), null);
    settings.clearOrigin('https://a');
    assert.equal(settings.getPermission('https://a', 'media-camera'), null);
  } finally { store.close(); }
});

test('site UA overrides validate origins, list in order, and survive clearSiteData', () => {
  const store = openStore(':memory:');
  try {
    const settings = new SiteSettings(store);
    settings.setUa('https://b.example/path', 'chrome');
    settings.setUa('https://a.example', 'electron');
    settings.setZoom('https://a.example', 125);
    settings.setPermissions('https://a.example', ['notifications'], 'allow');
    assert.deepEqual(settings.listUa(), [
      { origin: 'https://a.example', mode: 'electron' },
      { origin: 'https://b.example', mode: 'chrome' },
    ]);
    assert.throws(() => settings.setUa('chrome://settings', 'chrome'));
    settings.clearSiteData('https://a.example');
    assert.equal(settings.getUa('https://a.example'), 'electron');
    assert.equal(settings.getZoom('https://a.example'), 100);
    assert.equal(settings.getPermission('https://a.example', 'notifications'), null);
    settings.setUa('https://a.example', 'default');
    assert.equal(settings.getUa('https://a.example'), null);
  } finally { store.close(); }
});

test('session snapshots skip corruption and transaction rollback preserves earlier data', () => {
  const store = openStore(':memory:');
  try {
    const sessions = new Sessions(store);
    sessions.save({ version: 1 });
    store.prepare('INSERT INTO sessions(saved,data) VALUES(?,?)').run(1, '{');
    assert.deepEqual(sessions.latest(), { version: 1 });
    store.db.exec("CREATE TRIGGER reject_sessions BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'reject'); END");
    assert.throws(() => sessions.save({ version: 2 }));
    assert.deepEqual(sessions.latest(), { version: 1 });
  } finally { store.close(); }
});


test('version one database upgrades without losing sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-session-upgrade-')); const file = join(dir, 'store.db');
  try {
    const db = new DatabaseSync(file);
    db.exec(migrations[0].up); db.exec('PRAGMA user_version=1');
    db.prepare('INSERT INTO sessions(saved,data) VALUES(?,?)').run(1, JSON.stringify({ version: 1 })); db.close();
    const store = openStore(file);
    try { assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 4); assert.deepEqual(new Sessions(store).latest(), { version: 1 }); }
    finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('clean quit removes snapshots when restore is off, preserving closed tabs', () => {
  const store = openStore(':memory:');
  try {
    const sessions = new Sessions(store);
    sessions.save({ version: 1 }); sessions.pushClosed('closed');
    sessions.cleanQuit(true); assert.ok(sessions.latest());
    sessions.cleanQuit(false); assert.equal(sessions.latest(), null);
    assert.equal(store.prepare('SELECT count(*) AS count FROM sessions').get()?.count, 0);
    assert.equal(sessions.popClosed(), 'closed');
  } finally { store.close(); }
});

test('clean-exit marker persists across store reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-exit-')); const file = join(dir, 'store.db');
  try {
    let store = openStore(file); let prefs = new Prefs(store);
    assert.equal(prefs.get('cleanExit', true), true);
    prefs.set('cleanExit', false); store.close();
    store = openStore(file); prefs = new Prefs(store);
    assert.equal(prefs.get('cleanExit', true), false);
    prefs.set('cleanExit', true); store.close();
    store = openStore(file); assert.equal(new Prefs(store).get('cleanExit', false), true); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('history visits upgrade, range deletion, FTS and rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-history-upgrade-')); const file = join(dir, 'store.db');
  try {
    const db = new DatabaseSync(file); db.exec(migrations[0].up); db.exec(migrations[1].up); db.exec('PRAGMA user_version=2');
    db.prepare('INSERT INTO history(url,title,visits,typed,last_visit) VALUES(?,?,?,?,?)').run('https://example.com','Original',4,2,10); db.close();
    const store = openStore(file);
    try {
      const history = new History(store);
      assert.equal(store.prepare('SELECT count(*) AS n FROM history_visits').get()?.n, 1);
      history.visit('https://example.com','Original',false,20); history.visit('https://example.com','Original',true,30);
      assert.deepEqual(history.list('Original', null, 10).map(row => row.last_visit), [30, 20, 10]);
      assert.deepEqual(history.list('', 30, 10).map(row => row.last_visit), [20, 10]);
      assert.equal(history.recent(1)[0].visits, 3);
      history.removeRange(20,20);
      assert.deepEqual(store.prepare('SELECT visits,typed,last_visit FROM history').get(), Object.assign(Object.create(null), { visits: 2, typed: 2, last_visit: 30 }));
      assert.equal(history.search('Original',10).length,1);
      store.db.exec("CREATE TRIGGER reject_history BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, 'reject'); END");
      assert.throws(() => history.removeRange(30,30));
      assert.equal(store.prepare('SELECT count(*) AS n FROM history_visits').get()?.n,2);
      assert.throws(() => history.visit('https://example.com','Broken',false,40));
      assert.equal(store.prepare('SELECT count(*) AS n FROM history_visits').get()?.n,2);
      store.db.exec('DROP TRIGGER reject_history'); history.removeRange(0,100);
      assert.equal(history.search('Original',10).length,0);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('history migration failure rolls back schema and version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-history-rollback-')); const file = join(dir, 'store.db');
  try {
    const db = new DatabaseSync(file);
    db.exec(migrations[0].up); db.exec(migrations[1].up);
    db.exec('CREATE INDEX history_visits_time ON history(last_visit); PRAGMA user_version=2'); db.close();
    assert.throws(() => openStore(file));
    const after = new DatabaseSync(file);
    try {
      assert.equal(after.prepare('PRAGMA user_version').get()?.user_version, 2);
      assert.equal(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='history_visits'").get()?.n, 0);
    } finally { after.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bookmark folder deletion cascades transactionally', () => {
  const store = openStore(':memory:');
  try {
    const bookmarks = new Bookmarks(store);
    const folder = bookmarks.add({ parent: null, kind: 'folder', title: 'folder' });
    const nested = bookmarks.add({ parent: folder, kind: 'folder', title: 'nested' });
    bookmarks.add({ parent: nested, kind: 'link', title: 'link', url: 'https://example.com' });
    const survivor = bookmarks.add({ parent: null, kind: 'folder', title: 'survivor' });
    store.db.exec("CREATE TRIGGER prevent_bookmark_delete BEFORE DELETE ON bookmarks WHEN OLD.title='nested' BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    assert.throws(() => bookmarks.remove(folder));
    assert.equal(bookmarks.children(folder).length, 1);
    assert.equal(bookmarks.children(nested).length, 1);
    store.db.exec('DROP TRIGGER prevent_bookmark_delete');
    bookmarks.remove(folder);
    assert.deepEqual(bookmarks.children(null).map(row => [row.id, row.position]), [[survivor, 0]]);
    assert.deepEqual(bookmarks.children(nested), []);
  } finally { store.close(); }
});
