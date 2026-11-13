// Schema changes applied in version order.
export const migrations = [{ version: 1, up: `
CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE history (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '', visits INTEGER NOT NULL DEFAULT 0, typed INTEGER NOT NULL DEFAULT 0, last_visit INTEGER NOT NULL);
CREATE INDEX history_last_visit ON history(last_visit);
CREATE VIRTUAL TABLE history_fts USING fts5(url, title, content='history', content_rowid='id');
CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN INSERT INTO history_fts(rowid,url,title) VALUES(new.id,new.url,new.title); END;
CREATE TRIGGER history_ad AFTER DELETE ON history BEGIN INSERT INTO history_fts(history_fts,rowid,url,title) VALUES('delete',old.id,old.url,old.title); END;
CREATE TRIGGER history_au AFTER UPDATE ON history BEGIN INSERT INTO history_fts(history_fts,rowid,url,title) VALUES('delete',old.id,old.url,old.title); INSERT INTO history_fts(rowid,url,title) VALUES(new.id,new.url,new.title); END;
CREATE TABLE bookmarks (id INTEGER PRIMARY KEY, parent INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE, position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('folder','link')), title TEXT NOT NULL, url TEXT, created INTEGER NOT NULL);
CREATE TABLE sessions (id INTEGER PRIMARY KEY, saved INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE closed_tabs (id INTEGER PRIMARY KEY, closed INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE downloads (id INTEGER PRIMARY KEY, url TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER);
CREATE TABLE site_settings (origin TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(origin,key));
` }, { version: 2, up: `CREATE TABLE shortcuts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, position INTEGER NOT NULL);` }, { version: 3, up: `
CREATE TABLE history_visits (id INTEGER PRIMARY KEY, url TEXT NOT NULL, visited INTEGER NOT NULL, typed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX history_visits_time ON history_visits(visited);
CREATE INDEX history_visits_url ON history_visits(url);
INSERT INTO history_visits(url, visited, typed) SELECT url, last_visit, CASE WHEN typed > 0 THEN 1 ELSE 0 END FROM history;
` }, { version: 4, up: `CREATE TABLE favicons (origin TEXT PRIMARY KEY, data BLOB NOT NULL, updated INTEGER NOT NULL);` }];
