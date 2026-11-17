// Documento invisível que lê os vídeos da pasta local e os entrega em pedaços
// para o script que roda dentro da página do TikTok Studio.
import { getRootHandle, permissionState, scanFolder, resolveFile, readSidecar } from './lib/fsaccess.js';

async function root() {
  const h = await getRootHandle();
  if (!h) throw Object.assign(new Error('Nenhuma pasta de vídeos escolhida.'), { code: 'NO_FOLDER' });
  const state = await permissionState(h);
  if (state !== 'granted') {
    throw Object.assign(new Error('O Chrome precisa de permissão para ler a pasta. Abra o painel e clique em "Reautorizar pasta".'), { code: 'NEEDS_PERMISSION' });
  }
  return h;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(bin);
}

const handlers = {
  async scan() {
    const h = await root();
    return { folderName: h.name, files: await scanFolder(h) };
  },
  async permission() {
    const h = await getRootHandle();
    return { state: await permissionState(h), folderName: h?.name || null };
  },
  async 'file-meta'({ path }) {
    const f = await resolveFile(await root(), path);
    return { size: f.size, type: f.type || guessType(f.name), name: f.name, lastModified: f.lastModified };
  },
  async 'read-chunk'({ path, offset, length }) {
    const f = await resolveFile(await root(), path);
    const buf = await f.slice(offset, offset + length).arrayBuffer();
    return { b64: toBase64(buf), bytes: buf.byteLength };
  },
  async 'read-sidecar'({ path }) {
    return { text: await readSidecar(await root(), path) };
  },
};

function guessType(name) {
  if (/\.mov$/i.test(name)) return 'video/quicktime';
  if (/\.webm$/i.test(name)) return 'video/webm';
  return 'video/mp4';
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const fn = handlers[msg.type];
  if (!fn) return false;
  fn(msg)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e), code: e.code || 'ERROR' }));
  return true;
});
