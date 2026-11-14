// Per-origin JSON settings.
import type { PermissionEntry, Permission } from '../../shared/ipc.ts';
import { isUaMode, isUaPreference, normalizeSiteOrigin, type UaMode, type UaOverrideEntry, type UaPreference } from '../../shared/ua.ts';
import { isZoom } from '../../shared/zoom.ts';
import type { Store } from './db.ts';
export class SiteSettings {
  store: Store;
  constructor(store: Store) { this.store = store; }
  get<T>(origin: string, key: string, fallback: T): T { const row = this.store.prepare('SELECT value FROM site_settings WHERE origin=? AND key=?').get(origin,key); try { return row ? JSON.parse(String(row.value)) as T : fallback; } catch { return fallback; } }
  set(origin: string, key: string, value: unknown): void { this.store.prepare('INSERT INTO site_settings VALUES(?,?,?) ON CONFLICT(origin,key) DO UPDATE SET value=excluded.value').run(origin,key,JSON.stringify(value)); }
  delete(origin: string, key: string): void { this.store.prepare('DELETE FROM site_settings WHERE origin=? AND key=?').run(origin,key); }
  all(origin: string): Record<string, unknown> { const result: Record<string, unknown> = Object.create(null); for (const row of this.store.prepare('SELECT key,value FROM site_settings WHERE origin=?').all(origin)) { try { result[String(row.key)] = JSON.parse(String(row.value)); } catch { /* Ignore malformed settings. */ } } return result; }
  getZoom(origin: string): number { try { const value = this.get<unknown>(origin, 'zoom', 100); return isZoom(value) ? value : 100; } catch { return 100; } }
  setZoom(origin: string, value: number): void { if (!isZoom(value)) throw new RangeError('Invalid zoom'); if (value === 100) this.delete(origin, 'zoom'); else this.set(origin, 'zoom', value); }
  getUa(origin: string): UaMode | null { try { const value = this.get<unknown>(origin, 'ua', null); return isUaMode(value) ? value : null; } catch { return null; } }
  setUa(origin: string, preference: UaPreference): void {
    const normalized = normalizeSiteOrigin(origin);
    if (!normalized || !isUaPreference(preference)) throw new RangeError('Invalid site UA');
    if (preference === 'default') this.delete(normalized, 'ua');
    else this.set(normalized, 'ua', preference);
  }
  listUa(): UaOverrideEntry[] {
    return this.store.prepare("SELECT origin FROM site_settings WHERE key='ua' ORDER BY origin").all().flatMap(row => {
      const origin = normalizeSiteOrigin(String(row.origin));
      const mode = origin ? this.getUa(origin) : null;
      return origin && mode ? [{ origin, mode }] : [];
    });
  }
  listPermissions(): PermissionEntry[] {
    const valid = new Set(['media-camera', 'media-microphone', 'geolocation', 'notifications', 'clipboard-read']);
    return this.store.prepare("SELECT origin,key,value FROM site_settings WHERE key LIKE 'permission:%' ORDER BY origin,key").all().flatMap(row => {
      const origin = String(row.origin), permission = String(row.key).slice('permission:'.length);
      if (!valid.has(permission)) return [];
      const decision = this.getPermission(origin, permission);
      return decision ? [{ origin, permission: permission as Permission, decision }] : [];
    });
  }
  getPermission(origin: string, permission: string): 'allow' | 'deny' | null { const value = this.get<unknown>(origin, `permission:${permission}`, null); return value === 'allow' || value === 'deny' ? value : null; }
  setPermissions(origin: string, permissions: string[], decision: 'allow' | 'deny'): void {
    this.store.db.exec('BEGIN');
    try { for (const permission of permissions) this.set(origin, `permission:${permission}`, decision); this.store.db.exec('COMMIT'); }
    catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  clearSiteData(origin: string): void { this.store.prepare("DELETE FROM site_settings WHERE origin=? AND key!='ua'").run(origin); }
  clearOrigin(origin: string): void { this.store.prepare('DELETE FROM site_settings WHERE origin=?').run(origin); }
  clearAll(): void { this.store.prepare('DELETE FROM site_settings').run(); }
}
