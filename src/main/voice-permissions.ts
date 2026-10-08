import type { Session, WebContents, PermissionCheckHandlerHandlerDetails, MediaAccessPermissionRequest, PermissionRequest } from 'electron';
export function installVoicePermissions(session: Session, trusted: (contents: WebContents | null, url: string) => boolean, pending: () => boolean): void {
  // Check uses singular mediaType; request uses optional mediaTypes in Electron 44.4.1.
  session.setPermissionCheckHandler((contents, permission, _origin, details: PermissionCheckHandlerHandlerDetails) => {
    const local = details.isMainFrame === true && trusted(contents, details.requestingUrl ?? '');
    if (!local) return false;
    if (permission === 'clipboard-sanitized-write') return true;
    return permission === 'media' && details.mediaType === 'audio' && pending();
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const d = details as MediaAccessPermissionRequest & PermissionRequest;
    const local = d.isMainFrame === true && trusted(contents, d.requestingUrl);
    callback(local && (permission === 'clipboard-sanitized-write' || permission === 'media' && pending() &&
      Array.isArray(d.mediaTypes) && d.mediaTypes.length === 1 && d.mediaTypes[0] === 'audio'));
  });
}
