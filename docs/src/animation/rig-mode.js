function isLocalDevelopmentHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

export function shouldUseGeneratedRigs(
  search = '',
  { hostname = globalThis.location?.hostname ?? '' } = {},
) {
  if (!isLocalDevelopmentHost(hostname)) return true;
  return new URLSearchParams(search).get('rig') !== 'vector';
}
