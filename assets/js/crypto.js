/*
 * crypto.js — optional passphrase-based encryption for data at rest.
 *
 * Uses the browser's native Web Crypto API (AES-GCM 256 + PBKDF2).
 * Nothing here calls out to a network or third party. The derived
 * key lives only in memory for the current tab session — it is
 * never written to disk. If you forget your passphrase, there is
 * no way to recover encrypted data (this is by design: a recoverable
 * passphrase would defeat the point).
 */

function bytesToBase64(bytes){
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function base64ToBytes(b64){
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function deriveKey(passphrase, saltBytes){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  return key;
}

function newSalt(){ return crypto.getRandomValues(new Uint8Array(16)); }
function newIv(){ return crypto.getRandomValues(new Uint8Array(12)); }

async function encryptJSON(key, obj){
  const iv = newIv();
  const enc = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
  return { iv: bytesToBase64(iv), cipher };
}
async function decryptJSON(key, encObj){
  const iv = base64ToBytes(encObj.iv);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encObj.cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function encryptBlob(key, blob){
  const iv = newIv();
  const buf = await blob.arrayBuffer();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
  return { iv: bytesToBase64(iv), cipher, type: blob.type || 'application/octet-stream' };
}
async function decryptBlob(key, encObj){
  const iv = base64ToBytes(encObj.iv);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encObj.cipher);
  return new Blob([plain], { type: encObj.type || 'application/octet-stream' });
}

/* Encrypt a whole application record (metadata + attachment files) into
   the shape stored in IndexedDB when the lock is enabled. */
async function encryptRecord(key, plainApp){
  const attachmentsMeta = (plainApp.attachments||[]).map(a => ({
    id: a.id, label: a.label, filename: a.filename, type: a.type, size: a.size, uploadedDate: a.uploadedDate
  }));
  const meta = { ...plainApp, attachments: undefined };
  delete meta.attachments;
  meta.attachmentsMeta = attachmentsMeta;

  const encMeta = await encryptJSON(key, meta);

  const attachmentFiles = [];
  for(const a of (plainApp.attachments||[])){
    if(a.file){
      const enc = await encryptBlob(key, a.file);
      attachmentFiles.push({ id: a.id, iv: enc.iv, cipher: enc.cipher, type: enc.type });
    }
  }

  return {
    id: plainApp.id,
    created: plainApp.created,
    updated: plainApp.updated,
    encrypted: true,
    encMeta,
    attachmentFiles
  };
}

/* Decrypt a stored record back into the plain shape the UI works with. */
async function decryptRecord(key, rawRecord){
  const meta = await decryptJSON(key, rawRecord.encMeta);
  const attachments = [];
  for(const am of (meta.attachmentsMeta||[])){
    const enc = (rawRecord.attachmentFiles||[]).find(f => f.id === am.id);
    let file = null;
    if(enc){
      file = await decryptBlob(key, enc);
    }
    attachments.push({ ...am, file });
  }
  const { attachmentsMeta, ...rest } = meta;
  return { ...rest, attachments };
}
