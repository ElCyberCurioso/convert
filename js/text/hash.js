// Funciones hash. SHA-1/SHA-2 con WebCrypto (nativo, rápido); MD5, MD4 (NTLM),
// SHA-3/Keccak y CRC32 implementados aquí porque WebCrypto no los incluye.
// Todas reciben Uint8Array y devuelven Uint8Array.

const rotl = (x, n) => (x << n) | (x >>> (32 - n));

// ---------------------------------------------------------------- MD5 / MD4

/** Relleno Merkle–Damgård little-endian (MD4/MD5). */
function mdPad(bytes) {
  const len = bytes.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(len / 0x20000000), true);
  return { buf, dv };
}

const words = (state) => {
  const out = new Uint8Array(state.length * 4);
  const dv = new DataView(out.buffer);
  state.forEach((w, i) => dv.setUint32(i * 4, w >>> 0, true));
  return out;
};

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(bytes) {
  const { buf, dv } = mdPad(bytes);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + MD5_K[i] + M[g]) | 0, MD5_S[(i >> 4) * 4 + (i & 3)])) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return words([a0, b0, c0, d0]);
}

export function md4(bytes) {
  const { buf, dv } = mdPad(bytes);
  let A = 0x67452301, B = 0xefcdab89, C = 0x98badcfe, D = 0x10325476;
  const X = new Uint32Array(16);
  const F = (x, y, z) => (x & y) | (~x & z);
  const G = (x, y, z) => (x & y) | (x & z) | (y & z);
  const H = (x, y, z) => x ^ y ^ z;
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    let a = A, b = B, c = C, d = D;
    const r1 = [3, 7, 11, 19];
    for (let i = 0; i < 16; i++) {
      const t = rotl((a + F(b, c, d) + X[i]) | 0, r1[i & 3]);
      a = d; d = c; c = b; b = t;
    }
    const r2 = [3, 5, 9, 13];
    const o2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
    for (let i = 0; i < 16; i++) {
      const t = rotl((a + G(b, c, d) + X[o2[i]] + 0x5a827999) | 0, r2[i & 3]);
      a = d; d = c; c = b; b = t;
    }
    const r3 = [3, 9, 11, 15];
    const o3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let i = 0; i < 16; i++) {
      const t = rotl((a + H(b, c, d) + X[o3[i]] + 0x6ed9eba1) | 0, r3[i & 3]);
      a = d; d = c; c = b; b = t;
    }
    A = (A + a) | 0; B = (B + b) | 0; C = (C + c) | 0; D = (D + d) | 0;
  }
  return words([A, B, C, D]);
}

/** Hash NTLM (NT): MD4 de la contraseña en UTF-16LE. */
export function ntlm(text) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return md4(out);
}

// ---------------------------------------------------------------- SHA-3 / Keccak

// Constantes de ronda y desplazamientos calculados (no tabulados) para evitar erratas
const KECCAK_RC = (() => {
  const bit = (t) => { let r = 1; for (let i = 0; i < t % 255; i++) { r <<= 1; if (r & 0x100) r ^= 0x171; } return r & 1; };
  const rc = new Uint32Array(48);
  for (let ir = 0; ir < 24; ir++) {
    for (let j = 0; j <= 6; j++) {
      if (!bit(j + 7 * ir)) continue;
      const pos = (1 << j) - 1;
      if (pos < 32) rc[ir * 2] |= 1 << pos; else rc[ir * 2 + 1] |= 1 << (pos - 32);
    }
  }
  return rc;
})();
const KECCAK_ROT = (() => {
  const r = new Array(25).fill(0);
  let x = 1, y = 0;
  for (let t = 0; t < 24; t++) {
    r[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  return r;
})();

function keccakF(s) {
  const C = new Uint32Array(10), B = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    // θ
    for (let x = 0; x < 5; x++) {
      C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const p = ((x + 4) % 5) * 2, n = ((x + 1) % 5) * 2;
      const lo = C[p] ^ ((C[n] << 1) | (C[n + 1] >>> 31));
      const hi = C[p + 1] ^ ((C[n + 1] << 1) | (C[n] >>> 31));
      for (let y = 0; y < 25; y += 5) { s[2 * (x + y)] ^= lo; s[2 * (x + y) + 1] ^= hi; }
    }
    // ρ y π
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const n = KECCAK_ROT[i];
        let lo = s[2 * i], hi = s[2 * i + 1];
        if (n >= 32) { [lo, hi] = [hi, lo]; }
        const m = n % 32;
        const nlo = m ? (lo << m) | (hi >>> (32 - m)) : lo;
        const nhi = m ? (hi << m) | (lo >>> (32 - m)) : hi;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        B[2 * j] = nlo; B[2 * j + 1] = nhi;
      }
    }
    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = 2 * (x + y), a = 2 * (((x + 1) % 5) + y), b = 2 * (((x + 2) % 5) + y);
        s[i] = B[i] ^ (~B[a] & B[b]);
        s[i + 1] = B[i + 1] ^ (~B[a + 1] & B[b + 1]);
      }
    }
    // ι
    s[0] ^= KECCAK_RC[round * 2];
    s[1] ^= KECCAK_RC[round * 2 + 1];
  }
}

function keccak(bytes, bits, domain) {
  const rate = 200 - (bits / 4);
  const s = new Uint32Array(50);
  const view = new Uint8Array(s.buffer); // little-endian en todas las plataformas actuales
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= domain;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate; i++) view[i] ^= padded[off + i];
    keccakF(s);
  }
  return view.slice(0, bits / 8);
}

export const sha3_256 = (b) => keccak(b, 256, 0x06);
export const sha3_512 = (b) => keccak(b, 512, 0x06);
export const keccak256 = (b) => keccak(b, 256, 0x01);

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  c = (c ^ 0xffffffff) >>> 0;
  return new Uint8Array([c >>> 24, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff]);
}

// ---------------------------------------------------------------- WebCrypto y HMAC

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('El navegador no ofrece WebCrypto (¿página sin HTTPS?).');
  return crypto.subtle;
};
const digest = async (algo, bytes) => new Uint8Array(await subtle().digest(algo, bytes));

export const ALGORITHMS = [
  { id: 'md5', label: 'MD5', run: async (b) => md5(b) },
  { id: 'sha1', label: 'SHA-1', run: (b) => digest('SHA-1', b) },
  { id: 'sha256', label: 'SHA-256', run: (b) => digest('SHA-256', b) },
  { id: 'sha384', label: 'SHA-384', run: (b) => digest('SHA-384', b) },
  { id: 'sha512', label: 'SHA-512', run: (b) => digest('SHA-512', b) },
  { id: 'sha3_256', label: 'SHA3-256', run: async (b) => sha3_256(b) },
  { id: 'sha3_512', label: 'SHA3-512', run: async (b) => sha3_512(b) },
  { id: 'keccak256', label: 'Keccak-256', run: async (b) => keccak256(b) },
  { id: 'md4', label: 'MD4', run: async (b) => md4(b) },
  { id: 'crc32', label: 'CRC32', run: async (b) => crc32(b) },
];

/** Calcula todos los hashes de unos bytes: [{ id, label, bytes }]. */
export async function allHashes(bytes, only) {
  const list = only ? ALGORITHMS.filter((a) => only.includes(a.id)) : ALGORITHMS;
  return Promise.all(list.map(async (a) => ({ id: a.id, label: a.label, bytes: await a.run(bytes) })));
}

const HMAC_BLOCK = { 'SHA-1': 64, 'SHA-256': 64, 'SHA-384': 128, 'SHA-512': 128, MD5: 64 };

/** HMAC con clave en bytes. MD5 se calcula a mano; el resto con WebCrypto. */
export async function hmac(algo, keyBytes, bytes) {
  if (algo === 'MD5') {
    let key = keyBytes;
    if (key.length > 64) key = md5(key);
    const k = new Uint8Array(64); k.set(key);
    const ipad = k.map((x) => x ^ 0x36), opad = k.map((x) => x ^ 0x5c);
    const inner = md5(concat(ipad, bytes));
    return md5(concat(opad, inner));
  }
  if (!HMAC_BLOCK[algo]) throw new Error(`Algoritmo HMAC no soportado: ${algo}`);
  // WebCrypto no admite claves vacías: se usa el equivalente (un byte nulo se rellena igual)
  const key = await subtle().importKey('raw', keyBytes.length ? keyBytes : new Uint8Array(1), { name: 'HMAC', hash: algo }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', key, bytes));
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
