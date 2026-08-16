/*
 * db.js — persistent storage layer for Dossier.
 *
 * Uses IndexedDB so all data (including uploaded files) is stored
 * locally in the browser, works fully offline, and survives page
 * reloads. Because this is browser-local storage, use the
 * "Export backup" button regularly to keep a copy of your records
 * outside the browser (see README.md).
 */
const DB_NAME = 'dossierDB';
const DB_VERSION = 1;
const STORE = 'applications';

let _dbPromise = null;

function openDB(){
  if(_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function dbGetAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClearAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- helpers for converting File/Blob <-> base64 for JSON export/import ---- */
function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // data URL
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(dataUrl){
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [,'application/octet-stream'])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* Export all records to a plain JSON-serializable object (files -> base64) */
async function dbExportAll(){
  const records = await dbGetAll();
  const out = [];
  for(const rec of records){
    const clone = JSON.parse(JSON.stringify(rec, (k,v)=> v instanceof Blob ? undefined : v));
    clone.attachments = [];
    for(const att of (rec.attachments||[])){
      clone.attachments.push({
        id: att.id, label: att.label, filename: att.filename,
        type: att.type, size: att.size, uploadedDate: att.uploadedDate,
        dataUrl: att.file ? await blobToBase64(att.file) : null
      });
    }
    out.push(clone);
  }
  return {
    app: 'Dossier — Application & Interview Tracker',
    exportedAt: new Date().toISOString(),
    records: out
  };
}

/* Import records from a previously exported JSON object. Merges by id. */
async function dbImportAll(payload){
  const records = (payload && payload.records) || [];
  for(const rec of records){
    const restored = JSON.parse(JSON.stringify(rec));
    restored.attachments = [];
    for(const att of (rec.attachments||[])){
      restored.attachments.push({
        id: att.id, label: att.label, filename: att.filename,
        type: att.type, size: att.size, uploadedDate: att.uploadedDate,
        file: att.dataUrl ? base64ToBlob(att.dataUrl) : null
      });
    }
    await dbPut(restored);
  }
  return records.length;
}
