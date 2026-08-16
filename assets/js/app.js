/*
 * app.js — UI logic for Dossier.
 * All fields are optional. Data persists locally via IndexedDB (db.js).
 */
const STATUS_COLORS = {
  'Saved':'var(--stamp-saved)','Applied':'var(--stamp-applied)','Screening / OA':'var(--stamp-screen)',
  'Interview':'var(--stamp-interview)','Offer':'var(--stamp-offer)','Rejected':'var(--stamp-rejected)','Withdrawn':'var(--stamp-withdrawn)'
};
const STATUSES = Object.keys(STATUS_COLORS);
const TYPES = ['Job','PhD Position','Postdoc','Internship','Fellowship','Other'];

let apps = [];
let editingId = null;
let draftMaterials = [];
let draftInterviews = [];
let draftContacts = [];
let draftAttachments = [];
let objectUrls = []; // track for revocation

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e=document.createElement(tag); if(cls)e.className=cls; if(html!==undefined)e.innerHTML=html; return e; };

function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2400);
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

// ---------- storage ----------
async function loadApps(){
  try{
    apps = await dbGetAll();
  }catch(e){
    apps = [];
    toast('⚠ Could not open local storage in this browser');
  }
  render();
}

// ---------- init selects ----------
function initSelects(){
  const fs = $('#filterStatus'), ft = $('#filterType');
  STATUSES.forEach(s=>{ const o=el('option','',s); o.value=s; fs.appendChild(o); });
  TYPES.forEach(t=>{ const o=el('option','',t); o.value=t; ft.appendChild(o); });
}

// ---------- render list ----------
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
  $('#subtitle').textContent = apps.length+' entr'+(apps.length===1?'y':'ies')+' tracked — stored locally in this browser';
}

function renderStats(){
  const box = $('#stats'); box.innerHTML='';
  const counts = {};
  STATUSES.forEach(s=>counts[s]=0);
  apps.forEach(a=>{ if(a.status) counts[a.status]=(counts[a.status]||0)+1; });
  const show = ['Applied','Screening / OA','Interview','Offer'];
  show.forEach(s=>{
    const st = el('div','stat');
    st.innerHTML = `<span class="n">${counts[s]||0}</span><span class="l">${s.split(' ')[0]}</span>`;
    box.appendChild(st);
  });
  const total = el('div','stat');
  total.innerHTML = `<span class="n">${apps.length}</span><span class="l">Total</span>`;
  box.appendChild(total);
}

function renderGrid(){
  const wrap = $('#gridWrap');
  wrap.innerHTML='';
  const q = $('#search').value.trim().toLowerCase();
  const fStatus = $('#filterStatus').value;
  const fType = $('#filterType').value;
  const sortBy = $('#sortBy').value;

  let list = apps.filter(a=>{
    if(fStatus && a.status!==fStatus) return false;
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

// ---------- modal ----------
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
  document.querySelectorAll('.tabpanel').forEach(p=>p.classList.toggle('active', p.dataset.panel===name));
}

// attachments
function renderAttachments(){
  const wrap = $('#attachmentsList'); wrap.innerHTML='';
  draftAttachments.forEach((a,i)=>{
    const it = el('div','list-item');
    let link = '#';
    if(a.file){
      link = URL.createObjectURL(a.file);
      objectUrls.push(link);
    }
    it.innerHTML = `<div class="top"><b>${escapeHtml(a.label||a.filename||'Attachment')}</b><button class="remove-link" data-i="${i}">remove</button></div>
      <div class="small">${escapeHtml(a.filename||'')} ${a.size? '· '+fmtSize(a.size):''} ${a.uploadedDate? '· '+a.uploadedDate:''} ${a.file? `· <a href="${link}" target="_blank" rel="noopener">open</a>`:''}</div>`;
    it.querySelector('.remove-link').addEventListener('click', ()=>{ draftAttachments.splice(i,1); renderAttachments(); });
    wrap.appendChild(it);
  });
}

// materials
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

// interviews
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

// contacts
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

// ---------- events ----------
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
      label, filename: file.name, type: file.type, size: file.size,
      uploadedDate: new Date().toISOString().slice(0,10),
      file
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
      await dbPut(data);
      if(editingId){
        const idx = apps.findIndex(a=>a.id===editingId);
        apps[idx] = data;
      } else {
        apps.push(data);
      }
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
  ['filterStatus','filterType','sortBy'].forEach(id=> $('#'+id).addEventListener('change', render));

  $('#exportBtn').addEventListener('click', async ()=>{
    try{
      const payload = await dbExportAll();
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dossier-backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Backup downloaded');
    }catch(e){
      toast('⚠ Export failed');
    }
  });

  $('#importBtn').addEventListener('click', ()=> $('#importFile').click());
  $('#importFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      const text = await file.text();
      const payload = JSON.parse(text);
      const count = await dbImportAll(payload);
      await loadApps();
      toast('Imported '+count+' entr'+(count===1?'y':'ies'));
    }catch(err){
      toast('⚠ Could not read that backup file');
    }
    e.target.value = '';
  });
}

// ---------- boot ----------
initSelects();
bindEvents();
loadApps();
