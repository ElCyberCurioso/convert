// Hashes de archivos en un Worker: con archivos grandes no se bloquea la página.
import { allHashes, toHex } from '../text/hash.js';

const FAST = ['md5', 'sha1', 'sha256', 'sha512', 'crc32'];
const BIG = 256 * 1048576;

self.onmessage = async ({ data: { file } }) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // SHA-3, Keccak y MD4 están en JavaScript puro: con archivos grandes se omiten
    const rows = await allHashes(bytes, bytes.length > BIG ? FAST : undefined);
    self.postMessage({ rows: rows.map((r) => ({ id: r.id, label: r.label, hex: toHex(r.bytes) })), partial: bytes.length > BIG });
  } catch (e) {
    self.postMessage({ error: String(e?.message || e) });
  }
};
