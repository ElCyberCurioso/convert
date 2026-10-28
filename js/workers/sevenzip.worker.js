// 7-Zip (7z-wasm) en un Worker: crea 7Z y TAR(.GZ/.BZ2/.XZ) y sirve de respaldo
// para extraer lo que libarchive no puede (p. ej. 7Z cifrado con AES).
// callMain es síncrono: aquí no bloquea la interfaz.
import SevenZip from '../../vendor/7z/7zz.es6.js';

const STREAM = { tgz: 'gzip', tbz2: 'bzip2', txz: 'xz' };
const EXT = { '7z': '7z', tar: 'tar', tgz: 'tar.gz', tbz2: 'tar.bz2', txz: 'tar.xz' };

async function instance() {
  // Instancia nueva por trabajo: el sistema de archivos virtual empieza limpio
  const log = [];
  const sz = await SevenZip({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const run = (args) => {
    const code = sz.callMain(['-bd', '-bso0', '-bsp0', '-y', ...args]);
    if (code) throw new Error(log.filter((l) => l.trim()).slice(-4).join(' ') || `código ${code}`);
  };
  return { sz, FS: sz.FS, run };
}

function walk(FS, dir, base = '') {
  const out = [];
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const p = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    if (FS.isDir(FS.stat(p).mode)) out.push(...walk(FS, p, rel));
    else out.push({ path: rel, bytes: FS.readFile(p) });
  }
  return out;
}

async function create({ files, format, base, level }) {
  const { FS, run } = await instance();
  FS.mkdir('/in');
  FS.mkdir('/out');
  for (const f of files) {
    const path = `/in/${f.path}`;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir.length > 3) FS.mkdirTree(dir);
    FS.writeFile(path, new Uint8Array(f.bytes));
  }
  FS.chdir('/in');
  const out = `/out/${base}.${EXT[format]}`;
  if (format === '7z') run(['a', '-t7z', `-mx=${level ?? 5}`, '-r', out, '*']);
  else {
    run(['a', '-ttar', '-r', `/out/${base}.tar`, '*']);
    if (STREAM[format]) {
      FS.chdir('/out');
      run(['a', `-t${STREAM[format]}`, `-mx=${level ?? 7}`, out, `${base}.tar`]);
    }
  }
  return FS.readFile(out);
}

async function extract({ name, bytes, password }) {
  const { FS, run } = await instance();
  FS.mkdir('/in');
  FS.mkdir('/out');
  FS.writeFile(`/in/${name}`, new Uint8Array(bytes));
  // -p siempre presente: sin él 7-Zip intentaría pedir la contraseña por stdin
  run(['x', `-p${password || ''}`, '-o/out', `/in/${name}`]);
  return walk(FS, '/out');
}

self.onmessage = async ({ data }) => {
  try {
    if (data.op === 'extract') {
      const files = await extract(data);
      self.postMessage({ id: data.id, files }, files.map((f) => f.bytes.buffer));
    } else {
      const out = await create(data);
      self.postMessage({ id: data.id, out }, [out.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e?.message || e) });
  }
};
