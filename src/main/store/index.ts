// Public database repositories and browsing-data cleanup.
export * from './db.ts';
export * from './migrations.ts';
export * from './prefs.ts';
export * from './history.ts';
export * from './bookmarks.ts';
export * from './sessions.ts';
export * from './site-settings.ts';
export * from './downloads.ts';
export * from './shortcuts.ts';
export * from './favicons.ts';
import type { Store } from './db.ts';
export function clearBrowsingData(store: Store): void { store.db.exec('BEGIN'); try { store.db.exec('DELETE FROM history_visits; DELETE FROM history; DELETE FROM closed_tabs; DELETE FROM sessions; DELETE FROM downloads; DELETE FROM shortcuts; DELETE FROM site_settings; DELETE FROM favicons'); store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; } }
