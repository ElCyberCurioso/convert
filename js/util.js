// Utilidades compartidas

export class UserError extends Error {}
/** Error pensado para mostrarse tal cual al usuario. */
export const fail = (msg) => { throw new UserError(msg); };

/** Decodifica texto: BOM → UTF-8 estricto → Windows-1252 (CSV de Excel antiguos). */
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export const textBlob = (str, mime = 'text/plain', bom = false) =>
  new Blob(bom ? ['﻿', str] : [str], { type: `${mime};charset=utf-8` });

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const escapeXml = (s) => escapeHtml(s).replace(/'/g, '&apos;')
  // caracteres de control no válidos en XML 1.0
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new UserError('El navegador no pudo codificar la imagen.'))), mime, quality);
  });
}

export function bytesToBase64(bytes) {
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(out);
}

export function base64ToBytes(b64) {
  // Admite Base64 estándar y URL-safe, con o sin saltos de línea y relleno
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/_-]/g, '')
    .replace(/-/g, '+').replace(/_/g, '/');
  if (clean.length % 4 === 1) throw new UserError('El texto no es Base64 válido.');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function blobToDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

export function dataURLToBytes(url) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const bytes = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return { mime: m[1] || 'application/octet-stream', bytes };
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${nf.format(n)} ${u[i]}`;
}

export const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Nombre de archivo seguro (sin rutas ni caracteres problemáticos). */
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'archivo';

/** Descarga con progreso, devolviendo un Blob. */
export async function fetchWithProgress(url, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || '' });
}
