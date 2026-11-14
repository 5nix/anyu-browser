import type { Session } from 'electron';
import { shouldBlockSubresource } from '../shared/content-blocker.ts';

/**
 * Cancels third-party ad, popunder, and redirect-script subresource requests on the browsing
 * session. Main-frame redirects and popups are guarded in Tab so the page stays put instead of
 * landing on a cancelled-request error view.
 */
export function applyContentBlocker(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (!details.webContents && !details.initiatorOrigin) {
      callback({});
      return;
    }
    if (shouldBlockSubresource(details.url, details.resourceType, details.initiatorOrigin)) {
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}
