import type { Session, WebContents, PermissionCheckHandlerHandlerDetails, MediaAccessPermissionRequest, PermissionRequest } from 'electron';
import type { RealtimeSessionManager } from './realtime-session';
export function installVoicePermissions(session: Session, trusted: (contents: WebContents | null, url: string) => boolean, pending: () => boolean): void {
  // Check uses singular mediaType; request uses optional mediaTypes in Electron 44.4.1.
  // Fullscreen is allowed only for the trusted top frame so in-app video can still enter fullscreen.
  session.setPermissionCheckHandler((contents, permission, _origin, details: PermissionCheckHandlerHandlerDetails) => {
    const local = details.isMainFrame === true && trusted(contents, details.requestingUrl ?? '');
    if (!local) return false;
    if (permission === 'clipboard-sanitized-write' || permission === 'fullscreen') return true;
    return permission === 'media' && details.mediaType === 'audio' && pending();
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const d = details as MediaAccessPermissionRequest & PermissionRequest;
    const local = d.isMainFrame === true && trusted(contents, d.requestingUrl);
    callback(local && (permission === 'clipboard-sanitized-write' || permission === 'fullscreen' || permission === 'media' && pending() &&
      Array.isArray(d.mediaTypes) && d.mediaTypes.length === 1 && d.mediaTypes[0] === 'audio'));
  });
}
/** A crashed or destroyed renderer can no longer stop or acknowledge audio; close the paid socket from main. */
export function bindRendererLifecycle(contents: Pick<WebContents, 'on'>, manager: Pick<RealtimeSessionManager, 'abort'>): void {
  const abort = () => manager.abort('음성 화면이 비정상 종료되어 세션을 중단하고 저장하지 않은 확정문을 폐기했습니다. 다시 사용하려면 시작해 주세요.');
  contents.on('render-process-gone', abort);
  contents.on('destroyed', abort);
}
