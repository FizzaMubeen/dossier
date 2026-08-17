/*
 * app.js — UI logic for Dossier.
 * All fields are optional. Data persists locally via IndexedDB (db.js).
 * If a passphrase lock is enabled (crypto.js), records are encrypted
 * before being written to IndexedDB and decrypted into memory after
 * unlock; the rest of this file always works with the plain, decrypted
 * shape regardless of whether the lock is on.
 */
const STATUS_COLORS = {
  'Saved':'var(--stamp-saved)','Applied':'var(--stamp-applied)','Screening / OA':'var(--stamp-screen)',
  'Interview':'var(--stamp-interview)','Offer':'var(--stamp-offer)','Rejected':'var(--stamp-rejected)','Withdrawn':'var(--stamp-withdrawn)'
};
const STATUSES = Object.keys(STATUS_COLORS);
const TYPES = ['Job','PhD Position','Postdoc','Internship','Fellowship','Other'];

let apps = [];               // always the plain, decrypted, in-memory list
let editingId = null;
let draftMaterials = [];
let draftInterviews = [];
let draftContacts = [];
let draftAttachments = [];
let objectUrls = [];         // tracked for revocation
let activeStatusFilter = ''; // '' = all statuses

let securityEnabled = false;
let encryptionKey = null;    // in-memory only, never persisted
let securityMeta = null;     // { salt, verifierIv, verifierCipher, enabled }

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e=document.createElement(tag); if(cls)e.className=cls; if(html!==undefined)e.innerHTML=html; return e; };

function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2600);
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtSize(bytes){
  if(!bytes && bytes!==0) return '';
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}
function extOf(filename){
  const m = /\.([a-z0-9]+)$/i.exec(filename||'');
  return m ? m[1].toLowerCase() : '';
}
function slugify(s){
  return String(s||'file').trim().replace(/[^\w.\- ]+/g,'').replace(/\s+/g,'-').replace(/-+/g,'-') || 'file';
}
const MIME_BY_EXT = {
  pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
  doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:'text/plain', csv:'text/csv'
};

/* ============================= PERSISTENCE ============================= */

async function persistApp(data){
  if(securityEnabled && encryptionKey){
    const rawRecord = await encryptRecord(encryptionKey, data);
    await dbPut(rawRecord);
  } else {
    await dbPut(data);
  }
  const idx = apps.findIndex(a=>a.id===data.id);
  if(idx>=0) apps[idx] = data; else apps.push(data);
}

async function loadAllDecrypted(){
  const raw = await dbGetAll();
  const out = [];
  for(const r of raw){
    if(r.encrypted){
      if(!encryptionKey){ continue; } // shouldn't happen post-unlock, but guard anyway
      try{
        out.push(await decryptRecord(encryptionKey, r));
      }catch(e){
        // skip records that fail to decrypt rather than crashing the whole app
      }
    } else {
      out.push(r);
    }
  }
  return out;
}

async function loadApps(){
  try{
    apps = await loadAllDecrypted();
  }catch(e){
    apps = [];
    toast('⚠ Could not open local storage in this browser');
  }
  render();
}

/* ============================= SECURITY / LOCK ============================= */

async function initSecurity(){
  securityMeta = await dbGetMeta('security');
  securityEnabled = !!(securityMeta && securityMeta.enabled);
  if(securityEnabled){
    $('#unlockGate').classList.add('show');
    $('#mainApp').style.display = 'none';
  } else {
    $('#unlockGate').classList.remove('show');
    $('#mainApp').style.display = '';
    await loadApps();
  }
  refreshSecurityPanel();
}

async function attemptUnlock(passphrase){
  const salt = base64ToBytes(securityMeta.salt);
  const key = await deriveKey(passphrase, salt);
  try{
    const check = await decryptJSON(key, { iv: securityMeta.verifierIv, cipher: securityMeta.verifierCipher });
    if(check && check.ok === true){
      encryptionKey = key;
      $('#unlockGate').classList.remove('show');
      $('#mainApp').style.display = '';
      await loadApps();
      return true;
    }
    return false;
  }catch(e){
    return false;
  }
}

async function enableLock(passphrase){
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt);
  const verifier = await encryptJSON(key, { ok: true });
  // re-encrypt every existing (currently plain, in-memory) record
  for(const a of apps){
    const rawRecord = await encryptRecord(key, a);
    await dbPut(rawRecord);
  }
  const meta = {
    enabled: true,
    salt: bytesToBase64(salt),
    verifierIv: verifier.iv,
    verifierCipher: verifier.cipher
  };
  await dbSetMeta('security', meta);
  securityMeta = { key:'security', ...meta };
  securityEnabled = true;
  encryptionKey = key;
}

async function disableLock(passphrase){
  const salt = base64ToBytes(securityMeta.salt);
  const key = await deriveKey(passphrase, salt);
  const check = await decryptJSON(key, { iv: securityMeta.verifierIv, cipher: securityMeta.verifierCipher });
  if(!check || check.ok !== true) throw new Error('bad passphrase');
  // decrypt everything and write back as plain records
  const raw = await dbGetAll();
  for(const r of raw){
    if(r.encrypted){
      const plain = await decryptRecord(key, r);
      await dbPut(plain);
    }
  }
  await dbSetMeta('security', { enabled:false, salt:null, verifierIv:null, verifierCipher:null });
  securityMeta = { key:'security', enabled:false };
  securityEnabled = false;
  encryptionKey = null;
}

async function changePassphrase(currentPass, newPass){
  const salt = base64ToBytes(securityMeta.salt);
  const oldKey = await deriveKey(currentPass, salt);
  const check = await decryptJSON(oldKey, { iv: securityMeta.verifierIv, cipher: securityMeta.verifierCipher });
  if(!check || check.ok !== true) throw new Error('bad passphrase');

  const newSaltBytes = newSalt();
  const newKey = await deriveKey(newPass, newSaltBytes);
  const verifier = await encryptJSON(newKey, { ok: true });

  const raw = await dbGetAll();
  for(const r of raw){
    if(r.encrypted){
      const plain = await decryptRecord(oldKey, r);
      const reEncrypted = await encryptRecord(newKey, plain);
      await dbPut(reEncrypted);
    }
  }
  const meta = {
    enabled: true,
    salt: bytesToBase64(newSaltBytes),
    verifierIv: verifier.iv,
    verifierCipher: verifier.cipher
  };
  await dbSetMeta('security', meta);
  securityMeta = { key:'security', ...meta };
  encryptionKey = newKey;
}

function refreshSecurityPanel(){
  const statusEl = $('#securityStatus');
  const enableForm = $('#securityEnableForm');
  const manageForm = $('#securityManageForm');
  if(securityEnabled){
    statusEl.textContent = '🔒 Passphrase lock is ON. Your data is encrypted at rest.';
    enableForm.style.display = 'none';
    manageForm.style.display = 'block';
  } else {
    statusEl.textContent = '🔓 Passphrase lock is OFF. Data is stored in plain form in this browser.';
    enableForm.style.display = 'block';
    manageForm.style.display = 'none';
  }
}

/* ============================= RENDER ============================= */

function initSelects(){
  const ft = $('#filterType');
  TYPES.forEach(t=>{ const o=el('option','',t); o.value=t; ft.appendChild(o); });
}
function daysSince(dateStr){
  if(!dateStr) return null;
  const d = Math.floor((Date.now()-new Date(dateStr).getTime())/86400000);
  return d>=0? d : null;
}
function caseId(app){
  const idx = apps.slice().sort((a,b)=>a.created-b.created).findIndex(a=>a.id===app.id);
  return 'JT-'+String(idx+1).padStart(3,'0');
}

function render(){
  renderStats();
  renderGrid();
  $('#subtitle').textContent = apps.length+' entr'+(apps.length===1?'y':'ies')+' tracked — stored locally in this browser'+(securityEnabled? ' (encrypted)':'');
  refreshStorageEstimate();
  refreshBackupBanner();
}

/* ---- storage capacity + backup reminder ---- */
async function requestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      await navigator.storage.persist();
    }
  }catch(e){ /* not critical — best-effort only */ }
}

async function refreshStorageEstimate(){
  const box = $('#storageInfo');
  if(!box) return;
  if(!(navigator.storage && navigator.storage.estimate)){
    box.textContent = '';
    return;
  }
  try{
    const { usage, quota } = await navigator.storage.estimate();
    if(!quota){ box.textContent = ''; return; }
    const usedMB = usage/(1024*1024);
    const quotaMB = quota/(1024*1024);
    const usedStr = usedMB > 1024 ? (usedMB/1024).toFixed(2)+' GB' : usedMB.toFixed(1)+' MB';
    const quotaStr = quotaMB > 1024 ? (quotaMB/1024).toFixed(1)+' GB' : quotaMB.toFixed(0)+' MB';
    const pct = (usage/quota*100);
    box.textContent = `Local storage: ${usedStr} used of ~${quotaStr} available in this browser (${pct.toFixed(1)}%)`;
    box.classList.toggle('warn', pct > 75);
  }catch(e){
    box.textContent = '';
  }
}

async function refreshBackupBanner(){
  const banner = $('#backupBanner');
  if(!banner) return;
  banner.innerHTML = '';
  if(apps.length === 0) return;
  let meta = null;
  try{ meta = await dbGetMeta('lastExport'); }catch(e){}
  const last = meta ? meta.timestamp : null;
  const daysSince = last ? Math.floor((Date.now()-last)/86400000) : null;
  const shouldRemind = !last || daysSince >= 14;
  if(!shouldRemind) return;

  const msg = last
    ? `It's been ${daysSince} day${daysSince===1?'':'s'} since your last backup export.`
    : `You haven't exported a backup yet.`;
  const b = el('div','backup-banner');
  b.innerHTML = `<span>💾 ${msg} Browser storage isn't a permanent archive — export a copy for safekeeping.</span>`;
  const btn = el('button','btn small'); btn.textContent = 'Export now';
  btn.addEventListener('click', ()=> $('#exportBtn').click());
  b.appendChild(btn);
  banner.appendChild(b);
}

function renderStats(){
  const box = $('#stats'); box.innerHTML='';
  const counts = {};
  STATUSES.forEach(s=>counts[s]=0);
  apps.forEach(a=>{ if(a.status) counts[a.status]=(counts[a.status]||0)+1; });

  STATUSES.forEach(s=>{
    const st = el('div', 'stat'+(activeStatusFilter===s? ' active':''));
    st.innerHTML = `<span class="n">${counts[s]||0}</span><span class="l">${s.split(' ')[0]}</span>`;
    st.addEventListener('click', ()=>{
      activeStatusFilter = (activeStatusFilter===s) ? '' : s;
      render();
    });
    box.appendChild(st);
  });
  const total = el('div', 'stat'+(activeStatusFilter===''? ' active':''));
  total.innerHTML = `<span class="n">${apps.length}</span><span class="l">All</span>`;
  total.addEventListener('click', ()=>{ activeStatusFilter=''; render(); });
  box.appendChild(total);
}

function renderGrid(){
  const wrap = $('#gridWrap');
  wrap.innerHTML='';
  const q = $('#search').value.trim().toLowerCase();
  const fType = $('#filterType').value;
  const sortBy = $('#sortBy').value;

  let list = apps.filter(a=>{
    if(activeStatusFilter && a.status!==activeStatusFilter) return false;
    if(fType && a.type!==fType) return false;
    if(q){
      const hay = [a.company,a.position,a.location,a.notes,a.type].join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  list.sort((a,b)=>{
    if(sortBy==='recent') return (b.updated||0)-(a.updated||0);
    if(sortBy==='applied') return new Date(b.appliedDate||0)-new Date(a.appliedDate||0);
    if(sortBy==='deadline'){
      if(!a.deadline) return 1; if(!b.deadline) return -1;
      return new Date(a.deadline)-new Date(b.deadline);
    }
    if(sortBy==='company') return (a.company||'').localeCompare(b.company||'');
    return 0;
  });

  if(list.length===0){
    const e = el('div','empty');
    e.innerHTML = apps.length===0
      ? `<div class="big">No entries yet</div>Add your first application, PhD listing, or opportunity to start tracking.`
      : `<div class="big">No matches</div>Try clearing the search or filters.`;
    wrap.appendChild(e);
    return;
  }

  const grid = el('div','grid');
  list.forEach(a=>{
    const c = el('div','card');
    const ds = daysSince(a.appliedDate);
    const attCount = (a.attachments||[]).length;
    c.innerHTML = `
      <div class="rowflex">
        <span class="caseid">${caseId(a)}</span>
        ${a.type? `<span class="typechip">${escapeHtml(a.type)}</span>` : ''}
      </div>
      <h3>${escapeHtml(a.company||'Untitled entry')}</h3>
      <div class="pos">${escapeHtml(a.position||'—')}</div>
      <div class="meta">${escapeHtml(a.location||'')}</div>
      <div class="rowflex">
        <span class="badge" style="background:${STATUS_COLORS[a.status]||'var(--stamp-saved)'}">${escapeHtml(a.status||'Saved')}</span>
        <span style="font-size:11px;color:#6c6248;">${(a.interviews||[]).length? (a.interviews.length+' interview'+(a.interviews.length>1?'s':'')) : ''}</span>
      </div>
      ${attCount? `<div class="attn">📎 ${attCount} attachment${attCount>1?'s':''}</div>` : ''}
      ${ds!==null? `<div class="days">${ds} day${ds!==1?'s':''} since applied</div>` : ''}
    `;
    c.addEventListener('click', ()=>openModal(a.id));
    grid.appendChild(c);
  });
  wrap.appendChild(grid);
}

/* ============================= ENTRY MODAL ============================= */

function openModal(id){
  editingId = id || null;
  const app = id ? apps.find(a=>a.id===id) : null;

  $('#modalTitle').textContent = app ? 'Edit Entry' : 'New Entry';
  $('#deleteBtn').style.display = app ? 'inline-block' : 'none';

  $('#f_type').value = app?.type || '';
  $('#f_status').value = app?.status || 'Saved';
  $('#f_company').value = app?.company || '';
  $('#f_position').value = app?.position || '';
  $('#f_location').value = app?.location || '';
  $('#f_source').value = app?.source || '';
  $('#f_applieddate').value = app?.appliedDate || '';
  $('#f_deadline').value = app?.deadline || '';
  $('#f_link').value = app?.link || '';
  $('#f_jd').value = app?.jd || '';
  $('#f_notes').value = app?.notes || '';

  draftMaterials = app ? JSON.parse(JSON.stringify(app.materials||[])) : [];
  draftInterviews = app ? JSON.parse(JSON.stringify(app.interviews||[])) : [];
  draftContacts = app ? JSON.parse(JSON.stringify(app.contacts||[])) : [];
  draftAttachments = app ? (app.attachments||[]).map(a=>({...a})) : [];

  renderMaterials();
  renderInterviews();
  renderContacts();
  renderAttachments();
  renderMatChips();

  switchTab('overview');
  $('#overlay').classList.add('show');
}
function revokeObjectUrls(){
  objectUrls.forEach(u=>URL.revokeObjectURL(u));
  objectUrls = [];
}
function closeModal(){
  $('#overlay').classList.remove('show');
  revokeObjectUrls();
  editingId=null;
}
function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.tabpanel[data-panel]').forEach(p=>p.classList.toggle('active', p.dataset.panel===name));
}

/* ---- attachments ---- */
function isPreviewable(type){
  return type && (type.startsWith('image/') || type === 'application/pdf');
}
function renderAttachments(){
  const wrap = $('#attachmentsList'); wrap.innerHTML='';
  draftAttachments.forEach((a,i)=>{
    const it = el('div','list-item');
    let link = '#';
    if(a.file){
      link = URL.createObjectURL(a.file);
      objectUrls.push(link);
    }
    const previewable = a.file && isPreviewable(a.type);
    it.innerHTML = `<div class="top"><b>${escapeHtml(a.label||a.filename||'Attachment')}</b><button class="remove-link" data-i="${i}">remove</button></div>
      <div class="small">${escapeHtml(a.filename||'')} ${a.size? '· '+fmtSize(a.size):''} ${a.uploadedDate? '· '+a.uploadedDate:''}
        ${a.file? `· <a href="${link}" target="_blank" rel="noopener">open</a>` : ''}
        ${previewable? `· <button class="preview-toggle" data-i="${i}">preview</button>` : ''}
      </div>
      <div class="preview-slot" id="preview-slot-${i}"></div>`;
    it.querySelector('.remove-link').addEventListener('click', ()=>{ draftAttachments.splice(i,1); renderAttachments(); });
    const pt = it.querySelector('.preview-toggle');
    if(pt){
      pt.addEventListener('click', ()=>{
        const slot = it.querySelector(`#preview-slot-${i}`);
        if(slot.dataset.open === '1'){
          slot.innerHTML = ''; slot.dataset.open = '0'; pt.textContent = 'preview';
          return;
        }
        if(a.type.startsWith('image/')){
          slot.innerHTML = `<img src="${link}" alt="${escapeHtml(a.label||a.filename||'')}" class="preview-img">`;
        } else if(a.type === 'application/pdf'){
          slot.innerHTML = `<iframe src="${link}" class="preview-pdf" title="${escapeHtml(a.label||a.filename||'')}"></iframe>`;
        }
        slot.dataset.open = '1'; pt.textContent = 'hide preview';
      });
    }
    wrap.appendChild(it);
  });
}

/* ---- materials ---- */
function renderMaterials(){
  const wrap = $('#materialsList'); wrap.innerHTML='';
  draftMaterials.forEach((m,i)=>{
    const it = el('div','list-item');
    it.innerHTML = `<div class="top"><b>${escapeHtml(m.item)}</b><button class="remove-link" data-i="${i}">remove</button></div>
      <div class="small">${escapeHtml(m.version||'')}${m.date? ' · shared '+m.date : ''}</div>`;
    it.querySelector('.remove-link').addEventListener('click', ()=>{ draftMaterials.splice(i,1); renderMaterials(); renderMatChips(); });
    wrap.appendChild(it);
  });
}
function renderMatChips(){
  const wrap = $('#iv_matchips'); wrap.innerHTML='';
  if(draftMaterials.length===0){
    wrap.appendChild(el('span','small','Add materials in the previous tab to select them here.'));
    return;
  }
  draftMaterials.forEach((m,i)=>{
    const lbl = el('label','chipcheck');
    lbl.innerHTML = `<input type="checkbox" data-mi="${i}"> ${escapeHtml(m.item)}${m.version? ' ('+escapeHtml(m.version)+')':''}`;
    wrap.appendChild(lbl);
  });
}

/* ---- interviews ---- */
function renderInterviews(){
  const wrap = $('#interviewsList'); wrap.innerHTML='';
  draftInterviews.forEach((iv,i)=>{
    const it = el('div','list-item');
    it.innerHTML = `<div class="top"><b>${escapeHtml(iv.round||'Round')} — ${escapeHtml(iv.type||'')}</b><button class="remove-link" data-i="${i}">remove</button></div>
      <div class="small">${iv.date||'no date'} · ${escapeHtml(iv.outcome||'Pending')}${iv.shared&&iv.shared.length? ' · shared: '+iv.shared.map(escapeHtml).join(', '):''}</div>
      ${iv.notes? `<div class="small" style="margin-top:4px;">${escapeHtml(iv.notes)}</div>`:''}`;
    it.querySelector('.remove-link').addEventListener('click', ()=>{ draftInterviews.splice(i,1); renderInterviews(); });
    wrap.appendChild(it);
  });
}

/* ---- contacts ---- */
function renderContacts(){
  const wrap = $('#contactsList'); wrap.innerHTML='';
  draftContacts.forEach((c,i)=>{
    const it = el('div','list-item');
    it.innerHTML = `<div class="top"><b>${escapeHtml(c.name)}</b><button class="remove-link" data-i="${i}">remove</button></div>
      <div class="small">${escapeHtml(c.role||'')}${c.email? ' · '+escapeHtml(c.email):''}</div>`;
    it.querySelector('.remove-link').addEventListener('click', ()=>{ draftContacts.splice(i,1); renderContacts(); });
    wrap.appendChild(it);
  });
}

/* ============================= BULK IMPORT ============================= */

const SHEET_FIELD_MAP = {
  type:'type', status:'status', company:'company', institution:'company', companyinstitution:'company', employer:'company',
  position:'position', positiontitle:'position', role:'position', title:'position',
  location:'location', source:'source',
  applieddate:'appliedDate', dateapplied:'appliedDate', applied:'appliedDate',
  deadline:'deadline', link:'link', joblink:'link', url:'link',
  jd:'jd', jobdescription:'jd', description:'jd',
  notes:'notes', note:'notes'
};
function normalizeHeader(h){
  return String(h||'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function normalizeDateValue(v){
  if(!v) return '';
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  const s = String(v).trim();
  const d = new Date(s);
  if(!isNaN(d) && /\d{4}/.test(s)) return d.toISOString().slice(0,10);
  return s; // leave as-is if unparseable, user can fix later
}

async function importSpreadsheet(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type:'array', cellDates:true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval:'' });

  let imported = 0;
  for(const row of rows){
    const mapped = {};
    for(const key of Object.keys(row)){
      const norm = normalizeHeader(key);
      const field = SHEET_FIELD_MAP[norm];
      if(field) mapped[field] = row[key];
    }
    // skip fully blank rows
    if(Object.values(mapped).every(v => !String(v||'').trim())) continue;

    const now = Date.now();
    const status = STATUSES.find(s => s.toLowerCase() === String(mapped.status||'').trim().toLowerCase()) || 'Saved';
    const type = TYPES.find(t => t.toLowerCase() === String(mapped.type||'').trim().toLowerCase()) || '';

    const data = {
      id: 'a'+now+Math.random().toString(36).slice(2,7),
      created: now, updated: now,
      type, status,
      company: String(mapped.company||'').trim(),
      position: String(mapped.position||'').trim(),
      location: String(mapped.location||'').trim(),
      source: String(mapped.source||'').trim(),
      appliedDate: normalizeDateValue(mapped.appliedDate),
      deadline: normalizeDateValue(mapped.deadline),
      link: String(mapped.link||'').trim(),
      jd: String(mapped.jd||'').trim(),
      notes: String(mapped.notes||'').trim(),
      materials: [], interviews: [], contacts: [], attachments: []
    };
    await persistApp(data);
    imported++;
  }
  render();
  return imported;
}

function downloadTemplate(){
  const header = ['Type','Status','Company','Position','Location','Source','Applied Date','Deadline','Link','JD','Notes'];
  const example = ['Job','Applied','Acme Robotics','ML Engineer','Berlin','LinkedIn','2026-08-01','','https://example.com/job/123','','Referred by a friend'];
  const csv = [header, example].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dossier-import-template.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function importZipDocuments(file){
  const zip = await JSZip.loadAsync(file);
  const matched = [];
  const unmatched = [];
  const re = /^\s*([A-Za-z]{1,4}-\d+)[_\-\s]+(.+?)\s*$/i;

  const touched = new Set();

  for(const path of Object.keys(zip.files)){
    const entry = zip.files[path];
    if(entry.dir) continue;
    const filename = path.split('/').pop();
    const base = filename.replace(/\.[^.]+$/, '');
    const m = re.exec(base);
    if(!m){ unmatched.push(filename); continue; }
    const caseIdStr = m[1].toUpperCase();
    const label = m[2].replace(/[_\-]+/g,' ').trim();

    const target = /^([A-Za-z]+)-(\d+)$/.exec(caseIdStr);
    const app = target ? apps.find(a => {
      const cm = /^([A-Za-z]+)-(\d+)$/.exec(caseId(a));
      return cm && cm[1] === target[1] && parseInt(cm[2],10) === parseInt(target[2],10);
    }) : null;
    if(!app){ unmatched.push(filename + ' (no entry with case ID '+caseIdStr+')'); continue; }

    const blobData = await entry.async('blob');
    const ext = extOf(filename);
    const mime = blobData.type || MIME_BY_EXT[ext] || 'application/octet-stream';
    const typedBlob = blobData.type ? blobData : new Blob([blobData], { type: mime });

    if(!app.attachments) app.attachments = [];
    app.attachments.push({
      id: 'f'+Date.now()+Math.random().toString(36).slice(2,6),
      label: label || filename, filename, type: mime, size: typedBlob.size,
      uploadedDate: new Date().toISOString().slice(0,10),
      file: typedBlob
    });
    touched.add(app.id);
    matched.push(filename + ' → ' + caseIdStr);
  }

  for(const id of touched){
    const app = apps.find(a=>a.id===id);
    app.updated = Date.now();
    await persistApp(app);
  }
  render();
  return { matched, unmatched };
}

/* ============================= EXPORT / IMPORT BACKUP ============================= */

async function exportExcelWithAttachments(){
  const zip = new JSZip();
  const usedNames = new Set();
  const rows = [];

  for(const a of apps){
    const cid = caseId(a);
    const attFilenames = [];
    for(const att of (a.attachments||[])){
      if(!att.file) continue;
      const ext = extOf(att.filename) || (att.type && att.type.split('/')[1]) || 'bin';
      const base = `${cid}_${slugify(att.label || att.filename || 'file')}`;
      let name = `${base}.${ext}`, n = 2;
      while(usedNames.has(name)){ name = `${base}-${n}.${ext}`; n++; }
      usedNames.add(name);
      zip.file(`attachments/${name}`, att.file);
      attFilenames.push(name);
    }
    const materials = (a.materials||[]).map(m =>
      `${m.item}${m.version? ' ('+m.version+')':''}${m.date? ' - shared '+m.date:''}`
    ).join(' | ');
    const interviews = (a.interviews||[]).map(iv =>
      `${iv.round||'Round'} (${[iv.type,iv.date,iv.outcome].filter(Boolean).join(', ')})${iv.notes? ': '+iv.notes:''}`
    ).join(' | ');
    const contacts = (a.contacts||[]).map(c =>
      `${c.name}${c.role? ' ('+c.role+')':''}${c.email? ' '+c.email:''}`
    ).join('; ');

    rows.push({
      'Case ID': cid, 'Type': a.type||'', 'Status': a.status||'',
      'Company': a.company||'', 'Position': a.position||'', 'Location': a.location||'',
      'Source': a.source||'', 'Applied Date': a.appliedDate||'', 'Deadline': a.deadline||'',
      'Link': a.link||'', 'JD': a.jd||'', 'Notes': a.notes||'',
      'Materials Shared': materials, 'Interviews': interviews, 'Contacts': contacts,
      'Attachments': attFilenames.join('; ')
    });
  }

  const header = ['Case ID','Type','Status','Company','Position','Location','Source','Applied Date','Deadline','Link','JD','Notes','Materials Shared','Interviews','Contacts','Attachments'];
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Applications');
  const xlsxBytes = XLSX.write(wb, { type:'array', bookType:'xlsx' });
  zip.file('dossier-applications.xlsx', xlsxBytes);

  zip.file('README.txt',
    'This export contains:\n' +
    '  - dossier-applications.xlsx  (one row per tracked entry — open in Excel/Sheets)\n' +
    '  - attachments/               (every uploaded file, named <CaseID>_<Label>.<ext>)\n\n' +
    'To bring this back into Dossier:\n' +
    '  1. Bulk import > Spreadsheet — pick dossier-applications.xlsx to recreate the entries.\n' +
    '  2. Bulk import > Documents (.zip) — pick this same zip file (or a zip of just the\n' +
    '     attachments/ folder) to re-attach the files to the matching Case IDs.\n\n' +
    'Note: Materials Shared / Interviews / Contacts are flattened into readable text columns\n' +
    'here and will NOT restore as structured data through bulk import — only the core fields\n' +
    'and attachments do. For a full-fidelity restore of everything, use "Export backup (JSON)"\n' +
    'instead and restore it with "Import backup".\n\n' +
    'This file is not encrypted, regardless of whether the in-app passphrase lock is on.\n' +
    'Store it somewhere secure.'
  );

  const blob = await zip.generateAsync({ type:'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dossier-export-'+new Date().toISOString().slice(0,10)+'.zip';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function exportBackupJSON(){
  const records = [];
  for(const a of apps){
    const clone = JSON.parse(JSON.stringify(a));
    clone.attachments = [];
    for(const att of (a.attachments||[])){
      clone.attachments.push({
        id: att.id, label: att.label, filename: att.filename, type: att.type,
        size: att.size, uploadedDate: att.uploadedDate,
        dataUrl: att.file ? await blobToBase64(att.file) : null
      });
    }
    records.push(clone);
  }
  return {
    app: 'Dossier — Application & Interview Tracker',
    exportedAt: new Date().toISOString(),
    encryptedInApp: securityEnabled,
    note: 'This backup file itself is NOT encrypted. Store it somewhere secure.',
    records
  };
}

async function importBackupJSON(payload){
  const records = (payload && payload.records) || [];
  let count = 0;
  for(const rec of records){
    const restored = JSON.parse(JSON.stringify(rec));
    restored.attachments = [];
    for(const att of (rec.attachments||[])){
      restored.attachments.push({
        id: att.id, label: att.label, filename: att.filename, type: att.type,
        size: att.size, uploadedDate: att.uploadedDate,
        file: att.dataUrl ? base64ToBlob(att.dataUrl) : null
      });
    }
    if(!restored.id) restored.id = 'a'+Date.now()+Math.random().toString(36).slice(2,7);
    if(!restored.created) restored.created = Date.now();
    restored.updated = Date.now();
    await persistApp(restored);
    count++;
  }
  return count;
}

/* ============================= EVENTS ============================= */

function bindEvents(){
  $('#newBtn').addEventListener('click', ()=>openModal(null));
  $('#closeX').addEventListener('click', closeModal);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#overlay').addEventListener('click', e=>{ if(e.target.id==='overlay') closeModal(); });
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click', ()=>switchTab(t.dataset.tab)));

  $('#addAttachment').addEventListener('click', ()=>{
    const fileInput = $('#att_file');
    const file = fileInput.files[0];
    if(!file){ toast('Choose a file first'); return; }
    const label = $('#att_label').value.trim() || file.name;
    draftAttachments.push({
      id: 'f'+Date.now()+Math.random().toString(36).slice(2,6),
      label, filename: file.name, type: file.type || (MIME_BY_EXT[extOf(file.name)]||'application/octet-stream'),
      size: file.size, uploadedDate: new Date().toISOString().slice(0,10), file
    });
    $('#att_label').value=''; fileInput.value='';
    renderAttachments();
  });

  $('#addMaterial').addEventListener('click', ()=>{
    const item = $('#mat_item').value.trim();
    if(!item){ toast('Enter a material name first'); return; }
    draftMaterials.push({item, version:$('#mat_version').value.trim(), date:$('#mat_date').value});
    $('#mat_item').value=''; $('#mat_version').value=''; $('#mat_date').value='';
    renderMaterials(); renderMatChips();
  });

  $('#addInterview').addEventListener('click', ()=>{
    const round = $('#iv_round').value.trim() || 'Round';
    const shared = Array.from(document.querySelectorAll('#iv_matchips input[type=checkbox]:checked'))
      .map(cb=>draftMaterials[+cb.dataset.mi].item + (draftMaterials[+cb.dataset.mi].version? ' ('+draftMaterials[+cb.dataset.mi].version+')':''));
    draftInterviews.push({
      round, date:$('#iv_date').value, type:$('#iv_type').value, outcome:$('#iv_outcome').value,
      shared, notes:$('#iv_notes').value.trim()
    });
    $('#iv_round').value=''; $('#iv_date').value=''; $('#iv_notes').value='';
    document.querySelectorAll('#iv_matchips input[type=checkbox]').forEach(cb=>cb.checked=false);
    renderInterviews();
  });

  $('#addContact').addEventListener('click', ()=>{
    const name = $('#c_name').value.trim();
    if(!name){ toast('Enter a contact name first'); return; }
    draftContacts.push({name, role:$('#c_role').value.trim(), email:$('#c_email').value.trim()});
    $('#c_name').value=''; $('#c_role').value=''; $('#c_email').value='';
    renderContacts();
  });

  $('#saveBtn').addEventListener('click', async ()=>{
    const now = Date.now();
    const data = {
      id: editingId || ('a'+now+Math.random().toString(36).slice(2,7)),
      created: editingId ? (apps.find(a=>a.id===editingId).created) : now,
      updated: now,
      type: $('#f_type').value,
      status: $('#f_status').value || 'Saved',
      company: $('#f_company').value.trim(),
      position: $('#f_position').value.trim(),
      location: $('#f_location').value.trim(),
      source: $('#f_source').value.trim(),
      appliedDate: $('#f_applieddate').value,
      deadline: $('#f_deadline').value,
      link: $('#f_link').value.trim(),
      jd: $('#f_jd').value.trim(),
      notes: $('#f_notes').value.trim(),
      materials: draftMaterials,
      interviews: draftInterviews,
      contacts: draftContacts,
      attachments: draftAttachments
    };
    try{
      await persistApp(data);
      closeModal();
      render();
      toast('Entry saved');
    }catch(e){
      toast('⚠ Could not save — storage may be full');
    }
  });

  $('#deleteBtn').addEventListener('click', async ()=>{
    if(!editingId) return;
    if(!confirm('Delete this entry? This cannot be undone.')) return;
    await dbDelete(editingId);
    apps = apps.filter(a=>a.id!==editingId);
    closeModal();
    render();
    toast('Entry deleted');
  });

  ['search'].forEach(id=> $('#'+id).addEventListener('input', render));
  ['filterType','sortBy'].forEach(id=> $('#'+id).addEventListener('change', render));

  $('#exportBtn').addEventListener('click', async ()=>{
    try{
      const payload = await exportBackupJSON();
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'dossier-backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      await dbSetMeta('lastExport', { timestamp: Date.now() });
      refreshBackupBanner();
      toast('Backup downloaded');
    }catch(e){
      toast('⚠ Export failed');
    }
  });

  $('#exportExcelBtn').addEventListener('click', async ()=>{
    try{
      await exportExcelWithAttachments();
      await dbSetMeta('lastExport', { timestamp: Date.now() });
      refreshBackupBanner();
      toast('Excel + attachments downloaded');
    }catch(e){
      toast('⚠ Excel export failed');
    }
  });

  $('#importBtn').addEventListener('click', ()=> $('#importFile').click());
  $('#importFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      const text = await file.text();
      const payload = JSON.parse(text);
      const count = await importBackupJSON(payload);
      render();
      toast('Imported '+count+' entr'+(count===1?'y':'ies'));
    }catch(err){
      toast('⚠ Could not read that backup file');
    }
    e.target.value = '';
  });

  /* ---- bulk import modal ---- */
  $('#bulkImportBtn').addEventListener('click', ()=>{
    $('#sheetResult').textContent=''; $('#zipResult').textContent='';
    $('#bulkOverlay').classList.add('show');
  });
  $('#bulkCloseX').addEventListener('click', ()=> $('#bulkOverlay').classList.remove('show'));
  $('#bulkOverlay').addEventListener('click', e=>{ if(e.target.id==='bulkOverlay') $('#bulkOverlay').classList.remove('show'); });
  $('#downloadTemplate').addEventListener('click', downloadTemplate);

  $('#importSheetBtn').addEventListener('click', async ()=>{
    const file = $('#bulk_sheet_file').files[0];
    if(!file){ toast('Choose a spreadsheet file first'); return; }
    $('#sheetResult').textContent = 'Importing…';
    try{
      const count = await importSpreadsheet(file);
      $('#sheetResult').textContent = `Imported ${count} row${count===1?'':'s'}.`;
      toast('Spreadsheet imported');
    }catch(e){
      $('#sheetResult').textContent = '⚠ Could not read that file. Make sure it is a valid .xlsx or .csv.';
    }
  });

  $('#importZipBtn').addEventListener('click', async ()=>{
    const file = $('#bulk_zip_file').files[0];
    if(!file){ toast('Choose a zip file first'); return; }
    $('#zipResult').textContent = 'Importing…';
    try{
      const { matched, unmatched } = await importZipDocuments(file);
      let msg = `Attached ${matched.length} file${matched.length===1?'':'s'}.`;
      if(unmatched.length) msg += ` ${unmatched.length} unmatched: ${unmatched.join('; ')}`;
      $('#zipResult').textContent = msg;
      toast('Documents imported');
    }catch(e){
      $('#zipResult').textContent = '⚠ Could not read that zip file.';
    }
  });

  /* ---- security modal ---- */
  $('#securityBtn').addEventListener('click', ()=>{
    $('#securityMsg').textContent='';
    refreshSecurityPanel();
    $('#securityOverlay').classList.add('show');
  });
  $('#securityCloseX').addEventListener('click', ()=> $('#securityOverlay').classList.remove('show'));
  $('#securityOverlay').addEventListener('click', e=>{ if(e.target.id==='securityOverlay') $('#securityOverlay').classList.remove('show'); });

  $('#enableLockBtn').addEventListener('click', async ()=>{
    const p1 = $('#sec_pass1').value, p2 = $('#sec_pass2').value;
    if(!p1 || p1.length<4){ $('#securityMsg').textContent='Choose a passphrase of at least 4 characters.'; return; }
    if(p1!==p2){ $('#securityMsg').textContent='Passphrases do not match.'; return; }
    $('#securityMsg').textContent = 'Encrypting…';
    try{
      await enableLock(p1);
      $('#sec_pass1').value=''; $('#sec_pass2').value='';
      refreshSecurityPanel();
      $('#securityMsg').textContent = 'Passphrase lock enabled. All entries are now encrypted at rest.';
      toast('Lock enabled');
    }catch(e){
      $('#securityMsg').textContent = '⚠ Could not enable the lock.';
    }
  });

  $('#changeLockBtn').addEventListener('click', async ()=>{
    const cur = $('#sec_current').value, n1 = $('#sec_new1').value, n2 = $('#sec_new2').value;
    if(!n1 || n1.length<4){ $('#securityMsg').textContent='Choose a new passphrase of at least 4 characters.'; return; }
    if(n1!==n2){ $('#securityMsg').textContent='New passphrases do not match.'; return; }
    try{
      await changePassphrase(cur, n1);
      $('#sec_current').value=''; $('#sec_new1').value=''; $('#sec_new2').value='';
      $('#securityMsg').textContent = 'Passphrase changed.';
      toast('Passphrase changed');
    }catch(e){
      $('#securityMsg').textContent = '⚠ Current passphrase is incorrect.';
    }
  });

  $('#disableLockBtn').addEventListener('click', async ()=>{
    const pass = $('#sec_disable_pass').value;
    if(!confirm('Disable the passphrase lock? Data will be stored in plain form in this browser.')) return;
    try{
      await disableLock(pass);
      $('#sec_disable_pass').value='';
      refreshSecurityPanel();
      $('#securityMsg').textContent = 'Lock disabled.';
      toast('Lock disabled');
    }catch(e){
      $('#securityMsg').textContent = '⚠ Passphrase is incorrect.';
    }
  });

  /* ---- unlock gate ---- */
  $('#unlockBtn').addEventListener('click', doUnlock);
  $('#unlock_pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doUnlock(); });
  async function doUnlock(){
    const pass = $('#unlock_pass').value;
    $('#unlockError').textContent = '';
    const ok = await attemptUnlock(pass);
    if(!ok){
      $('#unlockError').textContent = 'Incorrect passphrase.';
    } else {
      $('#unlock_pass').value = '';
    }
  }
}

/* ============================= BOOT ============================= */
initSelects();
bindEvents();
requestPersistentStorage();
initSecurity();
