// resolves the page's import map for node (check-shop-kits.mjs)
const root = new URL('../../Web/three/', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'three' || specifier === 'three/webgpu') return { url: root + 'three.webgpu.js', shortCircuit: true };
  if (specifier === 'three/tsl') return { url: root + 'three.tsl.js', shortCircuit: true };
  return next(specifier, context);
}
