// El codificador WOFF2 (Emscripten + embind) genera funciones con eval.
// La CSP de la página lo prohíbe, así que se ejecuta aquí, en un Worker
// aislado sin acceso al DOM (la política <meta> no se aplica a workers
// cargados desde una URL del mismo origen).
import { compress, decompress } from '../../vendor/woff2/woff2.js';

self.onmessage = async ({ data: { id, op, bytes } }) => {
  try {
    const out = op === 'compress' ? await compress(bytes) : await decompress(bytes);
    self.postMessage({ id, out }, [out.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
