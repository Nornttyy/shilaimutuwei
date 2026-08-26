export function shouldUseGeneratedRigs(search = '') {
  return new URLSearchParams(search).get('rig') !== 'vector';
}
