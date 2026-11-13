export function trustworthyPermissionOrigin(url: URL): boolean {
  return !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
}
