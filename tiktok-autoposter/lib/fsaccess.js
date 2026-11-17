// Acesso à pasta de vídeos escolhida pelo usuário (File System Access API).
// O "handle" da pasta fica salvo no IndexedDB da extensão.

const DB = 'ttap';
const STORE = 'handles';
const KEY = 'videoRoot';
export const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const saveRootHandle = (handle) => tx('readwrite', (s) => s.put(handle, KEY));
export const getRootHandle = () => tx('readonly', (s) => s.get(KEY));

export const BACKUP_FILE = '_autoposter-config.json';

export async function permissionState(handle, request = false, mode = 'read') {
  if (!handle) return 'none';
  const opts = { mode };
  let state = await handle.queryPermission(opts);
  if (state !== 'granted' && request) state = await handle.requestPermission(opts);
  return state;
}

// Cada subpasta da raiz = um produto. Vídeos dentro dela (inclusive em subpastas) entram na fila.
export async function scanFolder(root) {
  const files = [];
  for await (const [name, entry] of root.entries()) {
    if (entry.kind !== 'directory' || name.startsWith('.')) continue;
    await walk(entry, name, name, files);
  }
  return files;
}

async function walk(dir, product, prefix, out) {
  const txts = new Set();
  const vids = [];
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (entry.kind === 'directory') {
      await walk(entry, product, `${prefix}/${name}`, out);
    } else if (VIDEO_EXT.test(name)) {
      vids.push([name, entry]);
    } else if (/\.txt$/i.test(name)) {
      txts.add(name.replace(/\.txt$/i, '').toLowerCase());
    }
  }
  for (const [name, entry] of vids) {
    const file = await entry.getFile();
    out.push({
      path: `${prefix}/${name}`,
      product,
      name,
      size: file.size,
      lastModified: file.lastModified,
      hasTxt: txts.has(name.replace(VIDEO_EXT, '').toLowerCase()),
    });
  }
}

// Cópia de segurança das configurações na raiz da pasta de vídeos (precisa de permissão de edição).
export async function writeBackup(root, json) {
  const fh = await root.getFileHandle(BACKUP_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(json);
  await w.close();
}
export async function readBackup(root) {
  try {
    const fh = await root.getFileHandle(BACKUP_FILE);
    return JSON.parse(await (await fh.getFile()).text());
  } catch (_) {
    return null;
  }
}

export async function resolveFile(root, path) {
  const parts = path.split('/');
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

export async function readSidecar(root, videoPath) {
  const txtPath = videoPath.replace(VIDEO_EXT, '.txt');
  const parts = txtPath.split('/');
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  const base = parts[parts.length - 1].toLowerCase();
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file' && name.toLowerCase() === base) return (await entry.getFile()).text();
  }
  return null;
}
