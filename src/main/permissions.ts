// Deny by default. Electron consults the request handler and the check handler separately,
// so both are set from the same decision function.
import type { Session } from 'electron';
import type { Profile } from '../shared/profile.ts';

const ALWAYS = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock']);

export function allowPermission(permission: string, profile: Profile): boolean {
  if (ALWAYS.has(permission)) return true;
  if (permission === 'geolocation') return profile.geolocation !== null;
  if (permission === 'notifications') return profile.notifications;
  return false;
}

export function applyPermissions(ses: Session, profile: () => Profile, request: (wc: Electron.WebContents, permission: string, details: Electron.PermissionRequest, callback: (allow: boolean) => void) => void, check: (wc: Electron.WebContents | null, permission: string, origin: string, details: Electron.PermissionCheckHandlerHandlerDetails) => boolean): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALWAYS.has(permission)) return callback(true);
    if ((permission === 'geolocation' || permission === 'notifications') && !allowPermission(permission, profile())) return callback(false);
    if (['media', 'geolocation', 'notifications', 'clipboard-read'].includes(permission)) return request(wc, permission, details, callback);
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => ALWAYS.has(permission) || check(wc, permission, origin, details));
  ses.setDevicePermissionHandler(() => false);
}
