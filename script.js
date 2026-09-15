const APP = {
  token: localStorage.getItem('vectra_session') || '',
  user: null,
  competitions: [],
  dashboard: null,
  currentCompetition: null,
  currentForm: null,
  adminPage: {page:1,pageSize:25,status:'',query:'',hasNext:false,rows:[]},
  adminSearchTimer: null
};

document.addEventListener('DOMContentLoaded', initApp);

// ---------------------------------------------------------------------------
// gs(): drop-in replacement for the old google.script.run bridge.
// Talks to the GAS Web App over plain fetch(). Content-Type is kept as
// text/plain on purpose: Apps Script Web Apps do not implement CORS preflight
// (OPTIONS) handling, so a "simple request" (text/plain body) is what avoids
// the browser sending a preflight that Apps Script would 404 on.
// The GAS side must expose the doPost() dispatcher from code-gs-adapter.gs.
// ---------------------------------------------------------------------------
async function gs(fn, ...args){
  if(!GAS_API_URL || GAS_API_URL.includes('GANTI_DENGAN')){
    throw new Error('GAS_API_URL belum diisi di firebase-config.js.');
  }
  let res;
  try{
    res = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: {'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action: fn, args })
    });
  }catch(networkErr){
    throw new Error('Tidak dapat terhubung ke server. Periksa koneksi atau GAS_API_URL.');
  }
  let data;
  try{ data = await res.json(); }
  catch(parseErr){ throw new Error('Respons server tidak valid.'); }
  if(data.error) throw new Error(data.error);
  return data.result;
}

async function initApp(){
  renderNav();
  setLoading(true);
  try{
    // Competitions/brand logo used to be templated server-side into
    // window.__VECTRA_BOOTSTRAP__ by HtmlService. On Vercel that template
    // step doesn't exist anymore, so we fetch the same payload over the API.
    const boot = await gs('getPublicBootstrap');
    APP.competitions = boot.competitions || [];
    applyBrandUrl(boot.brandLogoUrl || '');
  }catch(err){
    // Public landing page should still render even if the API is unreachable.
    applyBrandUrl('');
    toast('Gagal memuat data kompetisi: ' + err.message, true);
  }finally{
    setLoading(false);
  }
  renderCompetitions();

  if(!APP.token)return;
  setLoading(true);
  try{
    const res=await gs('resumeSession',APP.token);
    APP.user=res.user||null;
    APP.dashboard=res.workspace||null;
    renderNav();
    if(APP.user)await openDashboard(false);
    else throw new Error('Sesi tidak aktif.');
  }catch(err){
    localStorage.removeItem('vectra_session');APP.token='';APP.user=null;APP.dashboard=null;renderNav();
  }finally{setLoading(false)}
}

function applyBrandUrl(url){
  const img=document.getElementById('heroLogo');
  const fallback=document.getElementById('heroLogoFallback');
  // 1) Try a static file dropped into public/logos/brand.png (fastest, no API call)
  img.loading='eager';img.decoding='async';
  img.onerror=async()=>{
    img.onerror=null;
    // 2) Fall back to a Drive-hosted URL passed from the backend bootstrap
    if(url){
      img.src=url;
      img.onerror=async()=>{
        img.onerror=null;
        // 3) Last resort: fetch base64 through the API (private Drive file)
        try{
          const data=await gs('getBrandLogo');
          if(data){img.src=data;img.classList.remove('hidden');fallback.classList.add('hidden');return}
        }catch(e){}
        img.classList.add('hidden');fallback.classList.remove('hidden');
      };
      return;
    }
    img.classList.add('hidden');fallback.classList.remove('hidden');
  };
  img.onload=()=>{img.classList.remove('hidden');fallback.classList.add('hidden');};
  img.src='logos/brand.png';
}

function competitionLogoHtml(c,large=false){
  const cls=large?'competition-symbol large':'competition-symbol';
  const fallback=`<div class="${cls}">${escapeHtml((c.short_name||'V').slice(0,2))}</div>`;
  // Static local logo takes priority: drop public/logos/<competition_id>.png in the project.
  const staticSrc=`logos/${escapeAttr(c.competition_id)}.png`;
  return `<div class="logo-shell"><img loading="lazy" decoding="async" data-comp-id="${escapeAttr(c.competition_id)}" data-drive-url="${escapeAttr(c.logo_url||'')}" data-stage="static" src="${staticSrc}" alt="Logo ${escapeAttr(c.short_name||'VECTRA')}" onerror="logoFallback(this)"><div class="${cls}" style="display:none">${escapeHtml((c.short_name||'V').slice(0,2))}</div></div>`;
}

async function logoFallback(img){
  if(!img)return;
  // Stage 1 (static file) failed -> try the Drive-hosted URL from bootstrap, if any.
  if(img.dataset.stage==='static'){
    img.dataset.stage='drive';
    const driveUrl=img.dataset.driveUrl;
    if(driveUrl){img.src=driveUrl;return}
  }
  // Stage 2 (public Drive URL) failed or was absent -> try the authenticated API fallback.
  if(img.dataset.stage!=='api'){
    img.dataset.stage='api';
    try{
      const data=await gs('getCompetitionLogo',img.dataset.compId);
      if(data){img.src=data;return}
    }catch(e){}
  }
  // Stage 3: give up, show the letter badge.
  img.style.display='none';if(img.nextElementSibling)img.nextElementSibling.style.display='grid';
}

function syncDashboardCompetitionLogos(){
  if(!APP.dashboard||!APP.dashboard.competitions)return;
  const pubMap=Object.fromEntries((APP.competitions||[]).map(c=>[c.competition_id,c]));
  APP.dashboard.competitions.forEach(c=>{const p=pubMap[c.competition_id];if(p&&p.logo_url)c.logo_url=p.logo_url;});
}

function renderNav(){
  const el = document.getElementById('navActions');
  if(!APP.user){
    el.innerHTML = `<button class="btn ghost" onclick="openAuth('login')">Masuk</button><button class="btn primary" onclick="openAuth('register')">Buat Akun</button>`;
    return;
  }
  el.innerHTML = `<button class="btn ghost" onclick="openDashboard()">${escapeHtml(APP.user.name.split(' ')[0])} · Dashboard</button>`;
}

function renderCompetitions(){
  const grid = document.getElementById('competitionGrid');
  if(!APP.competitions.length){grid.innerHTML='<div class="empty">Belum ada lomba aktif.</div>';return}
  grid.innerHTML = APP.competitions.map(c=>{
    const open = c.status_label === 'Pendaftaran Dibuka';
    const badgeClass = open ? 'open' : (c.status_label.includes('Ditutup') ? 'closed' : '');
    const logo = competitionLogoHtml(c);
    return `<article class="competition-card">
      <div class="competition-logo">${logo}</div>
      <span class="badge ${badgeClass}">${escapeHtml(c.status_label)}</span>
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.summary || c.theme || '')}</p>
      <div class="competition-meta">
        <span>◎ ${escapeHtml(c.target || 'Peserta umum')}</span>
        <span>◷ ${formatPeriod(c.start_date,c.end_date)}</span>
      </div>
      <div class="competition-actions">
        <button class="btn ghost" onclick="openCompetition('${c.competition_id}')">Detail</button>
        <button class="btn primary" onclick="startRegistration('${c.competition_id}')">Daftar</button>
      </div>
    </article>`;
  }).join('');
}

async function openCompetition(id){
  const c=(APP.competitions||[]).find(x=>x.competition_id===id);
  if(!c){toast('Lomba tidak ditemukan.',true);return}
  APP.currentCompetition=c;
  const d=c.details||{};
  const logo=competitionLogoHtml(c,true);
  const requirements=(d.requirements||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')||'<li>Ketentuan dapat diperbarui oleh panitia.</li>';
  const timeline=(d.timeline||[]).map(t=>`<div class="timeline-row"><strong>${escapeHtml(t.date)}</strong><span>${escapeHtml(t.label)}</span></div>`).join('')||'<p class="form-subtitle">Timeline belum ditetapkan. Admin dapat memperbaruinya.</p>';
  const prizes=(d.prizes||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')||'<li>Informasi penghargaan akan diumumkan panitia.</li>';
  document.getElementById('detailContent').innerHTML=`
    <div class="detail-hero"><div class="detail-hero-logo">${logo}</div><div><span class="badge open">${escapeHtml(c.status_label)}</span><h2>${escapeHtml(c.name)}</h2><p>${escapeHtml(c.theme||'')}</p></div></div>
    <div class="detail-body">
      <p>${escapeHtml(d.summary||'')}</p>
      <div class="detail-columns"><div><h4>Ketentuan Utama</h4><ul class="detail-list">${requirements}</ul></div><div><h4>Penghargaan</h4><ul class="detail-list">${prizes}</ul></div></div>
      <div style="margin-top:26px"><h4>Timeline</h4><div class="timeline-list">${timeline}</div></div>
      <div class="detail-cta"><div><small>Sasaran peserta</small><br><b>${escapeHtml(c.target||'-')}</b></div><button class="btn primary" onclick="closeModal('detailModal');startRegistration('${c.competition_id}')">Daftar Lomba</button></div>
    </div>`;
  openModal('detailModal');
}

function openAuth(mode='login'){switchAuth(mode);openModal('authModal')}
function switchAuth(mode){
  document.getElementById('tabLogin').classList.toggle('active',mode==='login');
  document.getElementById('tabRegister').classList.toggle('active',mode==='register');
  const el=document.getElementById('authContent');
  if(mode==='login'){
    el.innerHTML=`<h3 class="form-title">Masuk ke portal</h3><p class="form-subtitle">Admin dan pendaftar menggunakan halaman login yang sama.</p>
    <div class="form-grid"><div class="field full"><label>Email</label><input id="loginEmail" type="email" placeholder="nama@email.com"></div><div class="field full"><label>Password</label><input id="loginPassword" type="password" placeholder="••••••••"></div></div>
    <div class="form-actions"><span></span><button class="btn primary" onclick="submitLogin()">Masuk</button></div>`;
  }else{
    el.innerHTML=`<h3 class="form-title">Buat akun pendaftar</h3><p class="form-subtitle">Buat akun terlebih dahulu agar data dapat disimpan sebagai draft.</p>
    <div class="form-grid"><div class="field full"><label>Nama lengkap</label><input id="regName"></div><div class="field"><label>Email</label><input id="regEmail" type="email"></div><div class="field"><label>WhatsApp</label><input id="regPhone" type="tel"></div><div class="field full"><label>Password <span class="req">*</span></label><input id="regPassword" type="password" placeholder="Minimal 8 karakter"></div></div>
    <div class="form-actions"><span></span><button class="btn primary" onclick="submitRegister()">Buat Akun</button></div>`;
  }
}

// ---------------------------------------------------------------------------
// Auth: Firebase handles the actual password check / account creation.
// The Apps Script backend then trades a verified Firebase identity for its
// own session token (still stored in localStorage exactly like before), and
// is responsible for creating/looking up the matching row in the USERS sheet
// keyed by Firebase uid instead of a locally-hashed password.
// See code-gs-adapter.gs + the login()/registerAccount() notes for the
// shape the backend needs to accept.
// ---------------------------------------------------------------------------
async function submitLogin(){
  const email=val('loginEmail'),password=val('loginPassword');
  if(!email||!password){toast('Email dan password wajib diisi.',true);return}
  setLoading(true);try{
    const cred=await firebaseAuth.signInWithEmailAndPassword(email,password);
    const idToken=await cred.user.getIdToken();
    const res=await gs('login',{email,uid:cred.user.uid,idToken});
    APP.token=res.token;APP.user=res.user;APP.dashboard=res.workspace||null;
    localStorage.setItem('vectra_session',APP.token);closeModal('authModal');renderNav();toast('Login berhasil.');await openDashboard(false);
  }catch(e){toast(mapAuthError(e),true)}finally{setLoading(false)}
}

async function submitRegister(){
  const name=val('regName'),email=val('regEmail'),phone=val('regPhone'),password=val('regPassword');
  if(!name||!email||!password){toast('Nama, email, dan password wajib diisi.',true);return}
  if(password.length<8){toast('Password minimal 8 karakter.',true);return}
  setLoading(true);try{
    const cred=await firebaseAuth.createUserWithEmailAndPassword(email,password);
    await cred.user.updateProfile({displayName:name});
    const idToken=await cred.user.getIdToken();
    const res=await gs('registerAccount',{name,email,phone,uid:cred.user.uid,idToken});
    APP.token=res.token;APP.user=res.user;APP.dashboard=res.workspace||null;
    localStorage.setItem('vectra_session',APP.token);closeModal('authModal');renderNav();toast('Akun berhasil dibuat.');await openDashboard(false);
  }catch(e){toast(mapAuthError(e),true)}finally{setLoading(false)}
}

function mapAuthError(e){
  const code=e && e.code;
  const map={
    'auth/email-already-in-use':'Email sudah terdaftar. Coba masuk, atau gunakan email lain.',
    'auth/invalid-email':'Format email tidak valid.',
    'auth/weak-password':'Password terlalu lemah, minimal 8 karakter.',
    'auth/user-not-found':'Akun tidak ditemukan.',
    'auth/wrong-password':'Email atau password salah.',
    'auth/invalid-credential':'Email atau password salah.',
    'auth/too-many-requests':'Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.'
  };
  return (code && map[code]) || e.message || 'Terjadi kesalahan saat autentikasi.';
}

async function logoutApp(){
  try{await gs('logout',APP.token)}catch(e){}
  try{await firebaseAuth.signOut()}catch(e){}
  APP.token='';APP.user=null;APP.dashboard=null;localStorage.removeItem('vectra_session');renderNav();goPublic();toast('Anda telah keluar.');
}

async function startRegistration(id){
  if(!APP.user){openAuth('register');toast('Buat akun atau login sebelum mengisi formulir.');return}
  if(APP.user.role!=='pendaftar'){toast('Akun admin tidak digunakan untuk mengisi formulir peserta.',true);return}
  await openRegistrationForm(id);
}

async function openRegistrationForm(id){
  setLoading(true);try{
    const data=await gs('getRegistrationForm',APP.token,id);APP.currentForm=data;
    renderRegistrationForm(data);openModal('formModal');
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

function renderRegistrationForm(data){
  const c=data.competition,p=data.payload||{},schema=data.schema||[];
  const status=data.registration?data.registration.status:'BELUM DIMULAI';
  const progress=data.registration?data.registration.progress:0;
  const editable=data.editable!==false;
  const fields=schema.map(f=>renderField(f,p[f.key])).join('');
  const readonlyNote=!editable?`<div class="file-box" style="margin-top:16px"><b>Form terkunci</b><div class="file-status">Pendaftaran berstatus ${escapeHtml(status)}. Data hanya dapat diedit ketika status DRAFT atau REVISION.</div></div>`:'';
  document.getElementById('registrationFormContent').innerHTML=`
    <span class="section-kicker">${escapeHtml(c.short_name)} · ${escapeHtml(status)}</span>
    <h2 class="form-title">${escapeHtml(c.name)}</h2>
    <p class="form-subtitle">Progress ${progress}% · ${editable?'Data dapat disimpan sebagai draft sebelum dikirim final.':'Pendaftaran telah dikirim dan sedang menunggu proses panitia.'}</p>
    <div class="progress"><span style="width:${progress}%"></span></div>
    <form id="dynamicRegistrationForm" onsubmit="event.preventDefault()" style="margin-top:22px"><div class="form-grid">${fields}</div></form>
    ${data.registration && data.registration.admin_note?`<div class="file-box" style="margin-top:16px"><b>Catatan admin</b><div class="file-status">${escapeHtml(data.registration.admin_note)}</div></div>`:''}
    ${readonlyNote}
    <div class="form-actions">${editable?'<button class="btn ghost" onclick="saveCurrentDraft()">Simpan Draft</button><button class="btn primary" onclick="submitCurrentRegistration()">Kirim Pendaftaran</button>':'<span></span><button class="btn ghost" onclick="closeModal(\'formModal\')">Tutup</button>'}</div>`;
  if(!editable){
    document.querySelectorAll('#dynamicRegistrationForm input,#dynamicRegistrationForm select,#dynamicRegistrationForm textarea').forEach(el=>{if(el.type!=='hidden')el.disabled=true});
  }
}

function renderField(f,value,uploadHandler='uploadFormFile'){
  const req=f.required?'<span class="req">*</span>':'';
  const note=f.note?`<div class="field-note">${escapeHtml(f.note)}</div>`:'';
  const full = ['textarea','checkbox','file'].includes(f.type) ? ' full' : '';
  const safe=escapeAttr(value==null?'':String(value));
  if(f.type==='textarea')return `<div class="field${full}" data-key="${f.key}"><label>${escapeHtml(f.label)} ${req}</label><textarea name="${f.key}" placeholder="${escapeAttr(f.placeholder||'')}">${escapeHtml(value||'')}</textarea>${note}</div>`;
  if(f.type==='select')return `<div class="field${full}" data-key="${f.key}"><label>${escapeHtml(f.label)} ${req}</label><select name="${f.key}"><option value="">Pilih...</option>${(f.options||[]).map(o=>`<option ${String(value)===String(o)?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select>${note}</div>`;
  if(f.type==='checkbox')return `<div class="field${full}" data-key="${f.key}"><label>${escapeHtml(f.label)} ${req}</label><label class="checkbox-row"><input type="checkbox" name="${f.key}" ${value===true||value==='true'?'checked':''}><span>${escapeHtml(f.checkboxText||f.label)}</span></label>${note}</div>`;
  if(f.type==='file'){
    const fileObj = value && typeof value==='object'?value:null;
    const existing=fileObj?`<a class="file-link" href="${escapeAttr(fileObj.url||'#')}" target="_blank">✓ ${escapeHtml(fileObj.fileName||'File tersimpan')}</a>`:'Belum ada file';
    return `<div class="field${full}" data-key="${f.key}"><label>${escapeHtml(f.label)} ${req}</label><div class="file-box"><input type="file" id="file_${f.key}" accept="${escapeAttr(f.accept||'')}" onchange="${uploadHandler}('${f.key}')"><input type="hidden" name="${f.key}" data-file-json value="${fileObj?escapeAttr(JSON.stringify(fileObj)):''}"><div class="file-status ${fileObj?'ok':''}" id="fileStatus_${f.key}">${existing}</div></div>${note}</div>`;
  }
  const type=['email','tel','number','date','url'].includes(f.type)?f.type:'text';
  return `<div class="field${full}" data-key="${f.key}"><label>${escapeHtml(f.label)} ${req}</label><input type="${type}" name="${f.key}" value="${safe}" placeholder="${escapeAttr(f.placeholder||'')}">${note}</div>`;
}

function readFileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(file)})}

// This handler was referenced (onchange="uploadFormFile(...)") but not
// implemented in the original bundle — filling it in here so file fields
// actually work: read the file client-side, ship it as base64 to the GAS
// backend, which writes it into the registration's Drive folder and returns
// {url, fileName} to store back into the hidden field.
async function uploadFormFile(key){
  const input=document.getElementById('file_'+key);
  const file=input.files && input.files[0];
  if(!file)return;
  const statusEl=document.getElementById('fileStatus_'+key);
  const hiddenEl=document.querySelector(`#dynamicRegistrationForm [name="${key}"][data-file-json]`);
  if(statusEl){statusEl.textContent='Mengunggah...';statusEl.classList.remove('ok')}
  try{
    const base64=await readFileBase64(file);
    const fileObj=await gs('uploadRegistrationFile',APP.token,APP.currentForm.competition.competition_id,key,{
      fileName:file.name, mimeType:file.type||'application/octet-stream', base64
    });
    if(hiddenEl)hiddenEl.value=JSON.stringify(fileObj);
    if(statusEl){
      statusEl.innerHTML=`<a class="file-link" href="${escapeAttr(fileObj.url||'#')}" target="_blank">✓ ${escapeHtml(fileObj.fileName||file.name)}</a>`;
      statusEl.classList.add('ok');
    }
  }catch(e){
    if(statusEl){statusEl.textContent='Gagal mengunggah file.';statusEl.classList.remove('ok')}
    toast(e.message,true);
  }
}

function collectRegistrationPayload(){
  const form=document.getElementById('dynamicRegistrationForm');const payload={};
  APP.currentForm.schema.forEach(f=>{
    const el=form.elements[f.key];if(!el)return;
    if(f.type==='checkbox')payload[f.key]=!!el.checked;
    else if(f.type==='file'){try{payload[f.key]=el.value?JSON.parse(el.value):null}catch(e){payload[f.key]=null}}
    else payload[f.key]=el.value;
  });
  return payload;
}

async function saveCurrentDraft(){
  const payload=collectRegistrationPayload();setLoading(true);try{
    const reg=await gs('saveDraft',APP.token,APP.currentForm.competition.competition_id,payload);APP.currentForm.registration=reg;
    upsertLocalParticipantRegistration(reg);toast('Draft tersimpan.');closeModal('formModal');renderParticipantOverview();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

function upsertLocalParticipantRegistration(reg){
  if(!APP.dashboard||APP.user.role!=='pendaftar')return;
  const rows=APP.dashboard.registrations||(APP.dashboard.registrations=[]);
  const i=rows.findIndex(x=>x.registration_id===reg.registration_id);
  if(i>=0)rows[i]=reg;else rows.unshift(reg);
  rows.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
}

async function submitCurrentRegistration(){
  if(!confirm('Kirim pendaftaran sekarang? Pastikan semua data dan dokumen sudah benar.'))return;
  const payload=collectRegistrationPayload();setLoading(true);try{
    const reg=await gs('submitRegistration',APP.token,APP.currentForm.competition.competition_id,payload);APP.currentForm.registration=reg;
    upsertLocalParticipantRegistration(reg);toast('Pendaftaran berhasil dikirim.');closeModal('formModal');renderParticipantOverview();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function openDashboard(forceReload=false){
  if(!APP.user)return;
  if(forceReload || !APP.dashboard){
    setLoading(true);
    try{
      const res=await gs('resumeSession',APP.token);APP.user=res.user;APP.dashboard=res.workspace;
    }catch(e){handleSessionError(e);return}finally{setLoading(false)}
  }
  renderNav();
  document.getElementById('publicView').classList.add('hidden');document.getElementById('publicFooter').classList.add('hidden');document.getElementById('dashboardView').classList.remove('hidden');
  renderSidebar();
  if(APP.user.role==='admin')renderAdminOverview();else renderParticipantOverview();
  window.scrollTo(0,0);
}

function goPublic(){
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('publicView').classList.remove('hidden');
  document.getElementById('publicFooter').classList.remove('hidden');
  window.scrollTo(0,0);
}

function goHome(){goPublic();setTimeout(()=>document.getElementById('beranda').scrollIntoView({behavior:'smooth'}),30)}
function openPublicSection(id){
  goPublic();
  document.getElementById('mobileLinks')?.classList.add('hidden');
  setTimeout(()=>{
    const target=document.getElementById(id);
    if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
  },50);
}

function renderSidebar(){
  const u=APP.user;
  document.getElementById('sideUser').innerHTML=`<b>${escapeHtml(u.name)}</b><span>${escapeHtml(u.email)}</span><small style="display:block;margin-top:5px;color:rgba(255,255,255,.42);text-transform:uppercase;letter-spacing:.08em">${escapeHtml(u.role)}</small>`;
  const menu=document.getElementById('sideMenu');
  if(u.role==='admin') menu.innerHTML=`
    <button class="active" onclick="renderAdminOverview(this)">Ringkasan</button>
    <button onclick="renderAdminRegistrations(this)">Pendaftaran</button>
    <button onclick="renderAdminSubmissions(this)">Pengumpulan Karya</button>
    <button onclick="renderAdminCompetitions(this)">Kelola Lomba</button>
    <button onclick="renderAdminSystem(this)">Sistem</button>
    <button onclick="renderAccountSettings(this)">Akun</button>`;
  else menu.innerHTML=`
    <button class="active" onclick="renderParticipantOverview(this)">Ringkasan</button>
    <button onclick="renderParticipantCompetitions(this)">Daftar Lomba</button>
    <button onclick="renderParticipantRegistrations(this)">Pendaftaran Saya</button>
    <button onclick="renderParticipantSubmissions(this)">Pengumpulan Karya</button>
    <button onclick="renderAccountSettings(this)">Akun</button>`;
}

function setActiveMenu(btn){if(!btn)return;document.querySelectorAll('#sideMenu button').forEach(x=>x.classList.remove('active'));btn.classList.add('active')}
function setDashTitle(kicker,title){document.getElementById('dashKicker').textContent=kicker;document.getElementById('dashTitle').textContent=title}

function renderParticipantOverview(btn){
  setActiveMenu(btn);setDashTitle('PENDAFTAR','Ringkasan Pendaftaran');
  const regs=APP.dashboard.registrations||[];const content=document.getElementById('dashboardContent');
  content.innerHTML=`<div class="stats-grid"><div class="stat-card"><span>Total Pendaftaran</span><strong>${regs.length}</strong></div><div class="stat-card"><span>Sudah Submit</span><strong>${regs.filter(r=>r.status!=='DRAFT').length}</strong></div><div class="stat-card"><span>Terverifikasi</span><strong>${regs.filter(r=>r.status==='VERIFIED').length}</strong></div><div class="stat-card"><span>Perlu Revisi</span><strong>${regs.filter(r=>r.status==='REVISION').length}</strong></div></div>
  <div class="panel"><div class="panel-head"><h3>Pendaftaran Anda</h3><button class="btn primary small" onclick="renderParticipantCompetitions()">+ Pilih Lomba</button></div>${renderRegCards(regs)}</div>`;
}

function renderParticipantCompetitions(btn){
  setActiveMenu(btn);setDashTitle('KOMPETISI','Pilih Lomba');
  const comps=APP.dashboard.competitions||[];document.getElementById('dashboardContent').innerHTML=`<div class="competition-grid">${comps.map(c=>{const logo=competitionLogoHtml(c);return `<article class="competition-card"><div class="competition-logo">${logo}</div><span class="badge">${escapeHtml(c.status_label)}</span><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.summary||c.theme||'')}</p><div class="competition-actions"><button class="btn ghost" onclick="openCompetition('${c.competition_id}')">Detail</button><button class="btn primary" onclick="openRegistrationForm('${c.competition_id}')">Isi Form</button></div></article>`}).join('')}</div>`;
}

function renderParticipantRegistrations(btn){setActiveMenu(btn);setDashTitle('DATA','Pendaftaran Saya');document.getElementById('dashboardContent').innerHTML=`<div class="panel" style="margin-top:0">${renderRegCards(APP.dashboard.registrations||[])}</div>`}

function renderRegCards(regs){
  if(!regs.length)return '<div class="empty">Belum ada pendaftaran. Pilih salah satu lomba untuk memulai.</div>';
  return `<div class="reg-cards">${regs.map(r=>`<div class="reg-card"><div class="reg-id">${escapeHtml(r.registration_id)}</div><h4>${escapeHtml(r.competition_name)}</h4><div class="progress"><span style="width:${r.progress}%"></span></div><div class="reg-meta"><span>Progress ${r.progress}%</span><span class="status-pill ${r.status}">${r.status}</span></div>${r.admin_note?`<p class="field-note" style="margin-top:10px">Catatan: ${escapeHtml(r.admin_note)}</p>`:''}<div style="margin-top:14px"><button class="btn ghost small" onclick="openRegistrationForm('${r.competition_id}')">${r.status==='DRAFT'||r.status==='REVISION'?'Lanjutkan / Perbaiki':'Lihat Form'}</button></div></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Pengumpulan Karya — decoupled from the registration form. Each competition
// can define multiple submission "tahap" (stages), each with its own
// open/close window set by the admin and its own file/field schema. A
// participant only needs an existing registration for the competition; the
// stage's own dates decide whether the upload button is enabled, not the
// registration's status.
// ---------------------------------------------------------------------------
async function renderParticipantSubmissions(btn){
  setActiveMenu(btn);setDashTitle('KARYA','Pengumpulan Karya');
  const content=document.getElementById('dashboardContent');
  content.innerHTML='<div class="panel" style="margin-top:0"><div class="empty">Memuat data tahap karya...</div></div>';
  try{
    const overview=await gs('getMySubmissionsOverview',APP.token);
    APP.dashboard.submissions=overview;
    if(!overview.length){content.innerHTML='<div class="panel" style="margin-top:0"><div class="empty">Belum ada lomba yang terdaftar. Daftar lomba dulu untuk membuka tahap pengumpulan karya.</div></div>';return}
    content.innerHTML=overview.map(regOverview=>`
      <div class="panel" style="margin-top:0">
        <div class="panel-head"><h3>${escapeHtml(regOverview.competition_name)}</h3><span class="reg-id">${escapeHtml(regOverview.registration_id)}</span></div>
        <div class="reg-cards">${regOverview.stages.map(s=>renderSubmissionStageCard(regOverview,s)).join('')}</div>
      </div>`).join('');
  }catch(e){handleSessionError(e)}
}

function renderSubmissionStageCard(regOverview,s){
  const now=new Date();
  const opensAt=s.opens_at?new Date(s.opens_at):null;
  const closesAt=s.closes_at?new Date(s.closes_at):null;
  const notOpenYet=opensAt&&now<opensAt;
  const alreadyClosed=closesAt&&now>closesAt;
  const isOpen=s.is_open!==undefined?s.is_open:(!notOpenYet&&!alreadyClosed);
  const status=s.submission?s.submission.status:'BELUM KUMPUL';
  const pillClass=['DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','REVISION','REJECTED'].includes(status)?status:'';
  let windowNote='Selalu terbuka';
  if(opensAt&&closesAt)windowNote=`${formatDateTime(s.opens_at)} – ${formatDateTime(s.closes_at)}`;
  else if(opensAt)windowNote=`Dibuka mulai ${formatDateTime(s.opens_at)}`;
  else if(closesAt)windowNote=`Ditutup ${formatDateTime(s.closes_at)}`;
  let actionBtn;
  if(notOpenYet)actionBtn='<button class="btn ghost small" disabled>Belum Dibuka</button>';
  else if(alreadyClosed&&!s.submission)actionBtn='<button class="btn ghost small" disabled>Sudah Ditutup</button>';
  else actionBtn=`<button class="btn ${s.submission?'ghost':'primary'} small" onclick="openSubmissionForm('${s.stage_id}')">${s.submission?'Lihat / Perbarui':'Unggah Karya'}</button>`;
  return `<div class="reg-card">
    <div class="reg-id">TAHAP ${escapeHtml(String(s.order||''))}</div>
    <h4>${escapeHtml(s.stage_name)}</h4>
    <p class="field-note" style="margin:6px 0 0">${escapeHtml(s.instructions||'')}</p>
    <div class="reg-meta" style="margin-top:14px"><span>${escapeHtml(windowNote)}</span>${pillClass?`<span class="status-pill ${pillClass}">${status}</span>`:'<span class="status-pill">'+escapeHtml(status)+'</span>'}</div>
    ${s.submission&&s.submission.admin_note?`<p class="field-note" style="margin-top:10px">Catatan: ${escapeHtml(s.submission.admin_note)}</p>`:''}
    <div style="margin-top:14px">${actionBtn}</div>
  </div>`;
}

async function openSubmissionForm(stageId){
  setLoading(true);try{
    const data=await gs('getSubmissionForm',APP.token,stageId);APP.currentSubmissionForm=data;
    renderSubmissionForm(data);openModal('submissionFormModal');
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

function renderSubmissionForm(data){
  const s=data.stage,p=data.payload||{},schema=data.schema||[];
  const status=data.submission?data.submission.status:'BELUM KUMPUL';
  const editable=data.editable!==false;
  const fields=schema.map(f=>renderField(f,p[f.key],'uploadSubmissionFile')).join('');
  const readonlyNote=!editable?`<div class="file-box" style="margin-top:16px"><b>Form terkunci</b><div class="file-status">Tahap ini berstatus ${escapeHtml(status)} atau sudah melewati jadwal.</div></div>`:'';
  document.getElementById('submissionFormContent').innerHTML=`
    <span class="section-kicker">${escapeHtml(s.competition_name)} · TAHAP ${escapeHtml(String(s.order||''))}</span>
    <h2 class="form-title">${escapeHtml(s.stage_name)}</h2>
    <p class="form-subtitle">${escapeHtml(s.instructions||'')}</p>
    <form id="dynamicSubmissionForm" onsubmit="event.preventDefault()" style="margin-top:22px"><div class="form-grid">${fields}</div></form>
    ${data.submission && data.submission.admin_note?`<div class="file-box" style="margin-top:16px"><b>Catatan panitia</b><div class="file-status">${escapeHtml(data.submission.admin_note)}</div></div>`:''}
    ${readonlyNote}
    <div class="form-actions">${editable?'<button class="btn ghost" onclick="saveCurrentSubmissionDraft()">Simpan Draft</button><button class="btn primary" onclick="submitCurrentSubmission()">Kumpulkan Karya</button>':'<span></span><button class="btn ghost" onclick="closeModal(\'submissionFormModal\')">Tutup</button>'}</div>`;
  if(!editable){
    document.querySelectorAll('#dynamicSubmissionForm input,#dynamicSubmissionForm select,#dynamicSubmissionForm textarea').forEach(el=>{if(el.type!=='hidden')el.disabled=true});
  }
}

async function uploadSubmissionFile(key){
  const input=document.getElementById('file_'+key);
  const file=input.files && input.files[0];
  if(!file)return;
  const statusEl=document.getElementById('fileStatus_'+key);
  const hiddenEl=document.querySelector(`#dynamicSubmissionForm [name="${key}"][data-file-json]`);
  if(statusEl){statusEl.textContent='Mengunggah...';statusEl.classList.remove('ok')}
  try{
    const base64=await readFileBase64(file);
    const fileObj=await gs('uploadSubmissionFile',APP.token,APP.currentSubmissionForm.stage.stage_id,key,{
      fileName:file.name, mimeType:file.type||'application/octet-stream', base64
    });
    if(hiddenEl)hiddenEl.value=JSON.stringify(fileObj);
    if(statusEl){
      statusEl.innerHTML=`<a class="file-link" href="${escapeAttr(fileObj.url||'#')}" target="_blank">✓ ${escapeHtml(fileObj.fileName||file.name)}</a>`;
      statusEl.classList.add('ok');
    }
  }catch(e){
    if(statusEl){statusEl.textContent='Gagal mengunggah file.';statusEl.classList.remove('ok')}
    toast(e.message,true);
  }
}

function collectSubmissionPayload(){
  const form=document.getElementById('dynamicSubmissionForm');const payload={};
  APP.currentSubmissionForm.schema.forEach(f=>{
    const el=form.elements[f.key];if(!el)return;
    if(f.type==='checkbox')payload[f.key]=!!el.checked;
    else if(f.type==='file'){try{payload[f.key]=el.value?JSON.parse(el.value):null}catch(e){payload[f.key]=null}}
    else payload[f.key]=el.value;
  });
  return payload;
}

async function saveCurrentSubmissionDraft(){
  const payload=collectSubmissionPayload();setLoading(true);try{
    const sub=await gs('saveSubmissionDraft',APP.token,APP.currentSubmissionForm.stage.stage_id,payload);APP.currentSubmissionForm.submission=sub;
    toast('Draft karya tersimpan.');closeModal('submissionFormModal');renderParticipantSubmissions();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function submitCurrentSubmission(){
  if(!confirm('Kumpulkan karya untuk tahap ini sekarang? Pastikan file sudah benar.'))return;
  const payload=collectSubmissionPayload();setLoading(true);try{
    const sub=await gs('submitSubmission',APP.token,APP.currentSubmissionForm.stage.stage_id,payload);APP.currentSubmissionForm.submission=sub;
    toast('Karya berhasil dikumpulkan.');closeModal('submissionFormModal');renderParticipantSubmissions();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

function renderAdminOverview(btn){
  setActiveMenu(btn);setDashTitle('ADMIN','Ringkasan Portal');const s=APP.dashboard.stats||{};
  document.getElementById('dashboardContent').innerHTML=`<div class="stats-grid"><div class="stat-card"><span>Total Pendaftaran</span><strong>${s.total||0}</strong></div><div class="stat-card"><span>Submitted</span><strong>${s.submitted||0}</strong></div><div class="stat-card"><span>Verified</span><strong>${s.verified||0}</strong></div><div class="stat-card"><span>Revision</span><strong>${s.revision||0}</strong></div></div><div class="panel"><div class="panel-head"><div><h3>Pendaftaran Terbaru</h3><p class="form-subtitle" style="margin:3px 0 0">Hanya 12 baris terbaru yang dibaca saat dashboard dibuka.</p></div><button class="btn ghost small" onclick="renderAdminRegistrations()">Lihat Semua</button></div>${renderAdminTable(APP.dashboard.recent||[])}</div>`;
}

async function renderAdminRegistrations(btn){
  setActiveMenu(btn);setDashTitle('ADMIN','Data Pendaftaran');
  document.getElementById('dashboardContent').innerHTML=`<div class="panel" style="margin-top:0"><div class="panel-head"><div><h3>Pendaftaran</h3><p class="form-subtitle" style="margin:3px 0 0">Pagination server-side, maksimal 25 data per halaman.</p></div><div class="admin-toolbar"><input class="search" id="adminSearch" placeholder="Cari nama, email, ID..." oninput="scheduleAdminSearch()"><select class="search" id="adminStatusFilter" onchange="loadAdminRegistrationPage(1)"><option value="">Semua Status</option><option>DRAFT</option><option>SUBMITTED</option><option>UNDER_REVIEW</option><option>VERIFIED</option><option>REVISION</option><option>REJECTED</option><option>CANCELLED</option></select></div></div><div id="adminTableBox"><div class="empty">Memuat 25 data terbaru...</div></div><div id="adminPager"></div></div>`;
  await loadAdminRegistrationPage(1);
}

function scheduleAdminSearch(){
  clearTimeout(APP.adminSearchTimer);APP.adminSearchTimer=setTimeout(()=>loadAdminRegistrationPage(1),420);
}

async function loadAdminRegistrationPage(page){
  APP.adminPage.page=page||1;
  APP.adminPage.status=val('adminStatusFilter');APP.adminPage.query=val('adminSearch');
  const box=document.getElementById('adminTableBox');if(box)box.innerHTML='<div class="empty">Memuat data...</div>';
  try{
    const res=await gs('getAdminRegistrationsPage',APP.token,APP.adminPage.page,APP.adminPage.pageSize,APP.adminPage.status,APP.adminPage.query);
    APP.adminPage={...APP.adminPage,...res};
    if(box)box.innerHTML=renderAdminTable(res.rows||[]);
    const pager=document.getElementById('adminPager');
    if(pager)pager.innerHTML=`<div class="pager"><button class="btn ghost small" ${res.hasPrev?'':'disabled'} onclick="loadAdminRegistrationPage(${Math.max(1,res.page-1)})">← Sebelumnya</button><span>Halaman ${res.page}</span><button class="btn ghost small" ${res.hasNext?'':'disabled'} onclick="loadAdminRegistrationPage(${res.page+1})">Selanjutnya →</button></div>`;
  }catch(e){handleSessionError(e)}
}

function filterAdminTable(){ scheduleAdminSearch(); }
function renderAdminTable(rows){
  if(!rows.length)return '<div class="empty">Belum ada data.</div>';
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Peserta</th><th>Lomba</th><th>Status</th><th>Progress</th><th>Update</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.registration_id)}</strong></td><td>${escapeHtml(r.participant_name)}<br><small>${escapeHtml(r.email)}</small></td><td>${escapeHtml(r.competition_name)}</td><td><span class="status-pill ${r.status}">${r.status}</span></td><td>${r.progress}%</td><td>${formatDateTime(r.updated_at)}</td><td><button class="btn ghost small" onclick="openAdminRegistration('${r.registration_id}')">Detail</button></td></tr>`).join('')}</tbody></table></div>`;
}

function renderAdminCompetitions(btn){
  setActiveMenu(btn);setDashTitle('ADMIN','Kelola Lomba');const comps=APP.dashboard.competitions||[];
  document.getElementById('dashboardContent').innerHTML=`<div class="panel" style="margin-top:0"><div class="panel-head"><div><h3>Daftar Lomba</h3><p class="form-subtitle" style="margin:3px 0 0">Master lomba kecil dan hanya dibaca saat menu ini dibutuhkan.</p></div><button class="btn primary" onclick="openCompetitionAdmin()">+ Tambah Lomba</button></div><div class="comp-admin-list">${comps.map(c=>`<div class="comp-admin-row"><div><h4>${escapeHtml(c.name)}</h4><p>${escapeHtml(c.short_name)} · ${escapeHtml(c.target||'-')} · ${escapeHtml(c.status_label)}</p></div><div class="row-actions"><button class="btn ghost small" onclick="openCompetitionAdmin('${c.competition_id}')">Edit</button><button class="btn ${String(c.status).toUpperCase()==='NONAKTIF'?'gold':'danger'} small" onclick="toggleCompetitionStatus('${c.competition_id}','${String(c.status).toUpperCase()==='NONAKTIF'?'AKTIF':'NONAKTIF'}')">${String(c.status).toUpperCase()==='NONAKTIF'?'Aktifkan':'Nonaktifkan'}</button></div></div>`).join('')}</div></div>`;
}

function openCompetitionAdmin(id=''){
  const c=id?(APP.dashboard.competitions||[]).find(x=>x.competition_id===id):null;const d=c&&c.details?c.details:{};
  document.getElementById('competitionAdminContent').innerHTML=`<span class="section-kicker">ADMIN · ${c?'EDIT':'TAMBAH'} LOMBA</span><h2 class="form-title">${c?'Edit kompetisi':'Tambah kompetisi baru'}</h2><p class="form-subtitle">Form generik akan dibuat otomatis. Form yang sangat spesifik dapat diedit langsung melalui kolom form_schema_json di sheet LOMBA. Untuk logo, letakkan file gambar bernama <code>${escapeHtml(c?c.competition_id:'ID_LOMBA')}.png</code> di folder <code>public/logos/</code> pada proyek Vercel — kolom di bawah ini hanya dipakai sebagai cadangan bila logo diambil dari Google Drive.</p>
  <input type="hidden" id="acId" value="${escapeAttr(c?c.competition_id:'')}"><div class="form-grid"><div class="field full"><label>Nama lomba *</label><input id="acName" value="${escapeAttr(c?c.name:'')}"></div><div class="field"><label>Nama singkat</label><input id="acShort" value="${escapeAttr(c?c.short_name:'')}"></div><div class="field"><label>Jenis peserta</label><select id="acType"><option value="individu" ${c&&c.participant_type==='individu'?'selected':''}>Individu</option><option value="tim" ${c&&c.participant_type==='tim'?'selected':''}>Tim</option></select></div><div class="field full"><label>Sasaran peserta</label><input id="acTarget" value="${escapeAttr(c?c.target:'')}"></div><div class="field full"><label>Tema</label><textarea id="acTheme">${escapeHtml(c?c.theme:'')}</textarea></div><div class="field"><label>Tanggal mulai</label><input id="acStart" type="date" value="${escapeAttr(c?c.start_date:'')}"></div><div class="field"><label>Tanggal akhir</label><input id="acEnd" type="date" value="${escapeAttr(c?c.end_date:'')}"></div><div class="field full"><label>ID file logo Google Drive (cadangan)</label><input id="acLogo" value="${escapeAttr(c?c.logo_file_id:'')}" placeholder="Tempel File ID logo"></div><div class="field full"><label>Ringkasan</label><textarea id="acSummary">${escapeHtml(d.summary||'')}</textarea></div><div class="field full"><label>Ketentuan utama (1 baris = 1 poin)</label><textarea id="acRequirements">${escapeHtml((d.requirements||[]).join('\n'))}</textarea></div></div><div class="form-actions"><button class="btn ghost" onclick="closeModal('competitionAdminModal')">Batal</button><button class="btn primary" onclick="saveCompetitionAdmin()">Simpan Lomba</button></div>`;
  openModal('competitionAdminModal');
}

async function saveCompetitionAdmin(){
  const payload={competition_id:val('acId'),name:val('acName'),short_name:val('acShort'),participant_type:val('acType'),target:val('acTarget'),theme:val('acTheme'),start_date:val('acStart'),end_date:val('acEnd'),logo_file_id:val('acLogo'),summary:val('acSummary'),requirements:val('acRequirements'),status:'AKTIF'};
  setLoading(true);try{
    await gs('adminUpsertCompetition',APP.token,payload);toast('Data lomba disimpan.');closeModal('competitionAdminModal');
    APP.dashboard.competitions=await gs('getAdminCompetitions',APP.token);
    APP.competitions=APP.dashboard.competitions.filter(c=>String(c.status||'').toUpperCase()!=='NONAKTIF');renderCompetitions();renderAdminCompetitions();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function toggleCompetitionStatus(id,status){
  if(!confirm(`Ubah status lomba menjadi ${status}?`))return;setLoading(true);try{
    await gs('adminSetCompetitionStatus',APP.token,id,status);
    APP.dashboard.competitions=await gs('getAdminCompetitions',APP.token);
    APP.competitions=APP.dashboard.competitions.filter(c=>String(c.status||'').toUpperCase()!=='NONAKTIF');renderCompetitions();renderAdminCompetitions();toast('Status lomba diperbarui.');
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

// ---------------------------------------------------------------------------
// Admin: Pengumpulan Karya — manage stages per competition (name, order,
// open/close window, instructions, schema) and review what's been uploaded,
// independent from the registration review table above.
// ---------------------------------------------------------------------------
async function renderAdminSubmissions(btn){
  setActiveMenu(btn);setDashTitle('ADMIN','Pengumpulan Karya');
  const comps=APP.dashboard.competitions||[];
  const content=document.getElementById('dashboardContent');
  content.innerHTML=`<div class="panel" style="margin-top:0">
    <div class="panel-head"><div><h3>Tahap per Lomba</h3><p class="form-subtitle" style="margin:3px 0 0">Pilih lomba untuk mengatur tahap pengumpulan karyanya.</p></div>
    <select class="search" id="submissionCompFilter" onchange="loadSubmissionStagesAdmin()"><option value="">Pilih lomba...</option>${comps.map(c=>`<option value="${escapeAttr(c.competition_id)}">${escapeHtml(c.name)}</option>`).join('')}</select></div>
    <div id="submissionStageList"><div class="empty">Pilih lomba di atas untuk melihat tahapnya.</div></div>
  </div>
  <div class="panel"><div class="panel-head"><div><h3>Data Karya Masuk</h3><p class="form-subtitle" style="margin:3px 0 0">Pagination server-side, maksimal 25 data per halaman.</p></div><div class="admin-toolbar"><input class="search" id="submissionSearch" placeholder="Cari nama, email, ID..." oninput="scheduleSubmissionSearch()"><select class="search" id="submissionStatusFilter" onchange="loadAdminSubmissionPage(1)"><option value="">Semua Status</option><option>DRAFT</option><option>SUBMITTED</option><option>UNDER_REVIEW</option><option>VERIFIED</option><option>REVISION</option><option>REJECTED</option></select></div></div><div id="submissionTableBox"><div class="empty">Memuat data terbaru...</div></div><div id="submissionPager"></div></div>`;
  await loadAdminSubmissionPage(1);
}

async function loadSubmissionStagesAdmin(){
  const competitionId=val('submissionCompFilter');
  const box=document.getElementById('submissionStageList');
  if(!competitionId){box.innerHTML='<div class="empty">Pilih lomba di atas untuk melihat tahapnya.</div>';return}
  box.innerHTML='<div class="empty">Memuat tahap...</div>';
  try{
    const stages=await gs('getAdminSubmissionStages',APP.token,competitionId);
    APP.adminSubmissionStages=stages;
    box.innerHTML=`<div class="comp-admin-list">${stages.map(s=>`<div class="comp-admin-row"><div><h4>Tahap ${escapeHtml(String(s.order))} · ${escapeHtml(s.stage_name)}</h4><p>${escapeHtml(formatDateTime(s.opens_at))} – ${escapeHtml(formatDateTime(s.closes_at))} · ${escapeHtml(s.status)}</p></div><div class="row-actions"><button class="btn ghost small" onclick="openSubmissionStageAdmin('${competitionId}','${s.stage_id}')">Edit</button><button class="btn ${s.status==='NONAKTIF'?'gold':'danger'} small" onclick="toggleSubmissionStageStatus('${competitionId}','${s.stage_id}','${s.status==='NONAKTIF'?'AKTIF':'NONAKTIF'}')">${s.status==='NONAKTIF'?'Aktifkan':'Nonaktifkan'}</button></div></div>`).join('')||'<div class="empty">Belum ada tahap untuk lomba ini.</div>'}
    <button class="btn primary small" style="margin-top:12px" onclick="openSubmissionStageAdmin('${competitionId}')">+ Tambah Tahap</button></div>`;
  }catch(e){handleSessionError(e)}
}

function openSubmissionStageAdmin(competitionId,stageId=''){
  const s=stageId?(APP.adminSubmissionStages||[]).find(x=>x.stage_id===stageId):null;
  document.getElementById('submissionStageAdminContent').innerHTML=`<span class="section-kicker">ADMIN · ${s?'EDIT':'TAMBAH'} TAHAP KARYA</span><h2 class="form-title">${s?'Edit tahap':'Tambah tahap baru'}</h2><p class="form-subtitle">Tahap default berisi satu field unggah file. Untuk field tambahan (misal deskripsi karya), isi Skema Tambahan dalam format JSON — bentuknya sama seperti form_schema_json pada sheet LOMBA.</p>
  <input type="hidden" id="ssId" value="${escapeAttr(stageId)}"><input type="hidden" id="ssCompId" value="${escapeAttr(competitionId)}">
  <div class="form-grid">
    <div class="field full"><label>Nama tahap *</label><input id="ssName" value="${escapeAttr(s?s.stage_name:'')}" placeholder="Karya Awal / Revisi Final"></div>
    <div class="field"><label>Urutan</label><input id="ssOrder" type="number" value="${escapeAttr(s?s.order:'')}"></div>
    <div class="field"><label>Label field file</label><input id="ssFileLabel" value="${escapeAttr(s?s.file_label:'File Karya')}" placeholder="File poster"></div>
    <div class="field"><label>Buka mulai</label><input id="ssStart" type="datetime-local" value="${escapeAttr(s?s.opens_at:'')}"></div>
    <div class="field"><label>Tutup pada</label><input id="ssEnd" type="datetime-local" value="${escapeAttr(s?s.closes_at:'')}"></div>
    <div class="field full"><label>Instruksi (ditampilkan ke peserta)</label><textarea id="ssInstructions" placeholder="JPG/JPEG/PNG, maksimal 15 MB. Panduan: A2, minimal 300 dpi.">${escapeHtml(s?s.instructions:'')}</textarea></div>
    <div class="field full"><label>Skema tambahan (JSON, opsional)</label><textarea id="ssExtraSchema" placeholder='[{"key":"deskripsi","label":"Deskripsi Karya","type":"textarea"}]'>${escapeHtml(s&&s.extra_schema_json?s.extra_schema_json:'')}</textarea></div>
  </div>
  <div class="form-actions"><button class="btn ghost" onclick="closeModal('submissionStageAdminModal')">Batal</button><button class="btn primary" onclick="saveSubmissionStageAdmin()">Simpan Tahap</button></div>`;
  openModal('submissionStageAdminModal');
}

async function saveSubmissionStageAdmin(){
  const payload={stage_id:val('ssId'),competition_id:val('ssCompId'),stage_name:val('ssName'),order:val('ssOrder'),file_label:val('ssFileLabel'),opens_at:val('ssStart'),closes_at:val('ssEnd'),instructions:val('ssInstructions'),extra_schema_json:val('ssExtraSchema'),status:'AKTIF'};
  setLoading(true);try{
    await gs('adminUpsertSubmissionStage',APP.token,payload);toast('Tahap karya disimpan.');closeModal('submissionStageAdminModal');
    await loadSubmissionStagesAdmin();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function toggleSubmissionStageStatus(competitionId,stageId,status){
  if(!confirm(`Ubah status tahap menjadi ${status}?`))return;setLoading(true);try{
    await gs('adminSetSubmissionStageStatus',APP.token,stageId,status);toast('Status tahap diperbarui.');
    await loadSubmissionStagesAdmin();
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

function scheduleSubmissionSearch(){
  clearTimeout(APP.submissionSearchTimer);APP.submissionSearchTimer=setTimeout(()=>loadAdminSubmissionPage(1),420);
}

async function loadAdminSubmissionPage(page){
  APP.adminSubmissionPage=APP.adminSubmissionPage||{page:1,pageSize:25};
  APP.adminSubmissionPage.page=page||1;
  APP.adminSubmissionPage.status=val('submissionStatusFilter');APP.adminSubmissionPage.query=val('submissionSearch');
  const box=document.getElementById('submissionTableBox');if(box)box.innerHTML='<div class="empty">Memuat data...</div>';
  try{
    const res=await gs('getAdminSubmissionsPage',APP.token,APP.adminSubmissionPage.page,APP.adminSubmissionPage.pageSize,APP.adminSubmissionPage.status,APP.adminSubmissionPage.query);
    APP.adminSubmissionPage={...APP.adminSubmissionPage,...res};
    if(box)box.innerHTML=renderAdminSubmissionTable(res.rows||[]);
    const pager=document.getElementById('submissionPager');
    if(pager)pager.innerHTML=`<div class="pager"><button class="btn ghost small" ${res.hasPrev?'':'disabled'} onclick="loadAdminSubmissionPage(${Math.max(1,res.page-1)})">← Sebelumnya</button><span>Halaman ${res.page}</span><button class="btn ghost small" ${res.hasNext?'':'disabled'} onclick="loadAdminSubmissionPage(${res.page+1})">Selanjutnya →</button></div>`;
  }catch(e){handleSessionError(e)}
}

function renderAdminSubmissionTable(rows){
  if(!rows.length)return '<div class="empty">Belum ada data.</div>';
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Peserta</th><th>Lomba</th><th>Tahap</th><th>Status</th><th>Update</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.submission_id)}</strong></td><td>${escapeHtml(r.participant_name)}<br><small>${escapeHtml(r.email)}</small></td><td>${escapeHtml(r.competition_name)}</td><td>${escapeHtml(r.stage_name)}</td><td><span class="status-pill ${r.status}">${r.status}</span></td><td>${formatDateTime(r.updated_at)}</td><td><button class="btn ghost small" onclick="openAdminSubmission('${r.submission_id}')">Detail</button></td></tr>`).join('')}</tbody></table></div>`;
}

async function openAdminSubmission(id){
  setLoading(true);try{
    const d=await gs('adminGetSubmissionDetail',APP.token,id),r=d.submission,p=d.payload||{};
    const kv=Object.entries(p).map(([k,v])=>{let show='';if(v&&typeof v==='object'&&v.url)show=`<a href="${escapeAttr(v.url)}" target="_blank">${escapeHtml(v.fileName||'Buka file')}</a>`;else if(typeof v==='boolean')show=v?'Ya':'Tidak';else show=escapeHtml(String(v??''));return `<div class="kv"><span>${escapeHtml(humanize(k))}</span><b>${show||'-'}</b></div>`}).join('');
    document.getElementById('adminSubmissionContent').innerHTML=`<div class="admin-reg-head"><span class="section-kicker">DETAIL KARYA</span><h2>${escapeHtml(r.submission_id)}</h2><p class="form-subtitle" style="margin:0">${escapeHtml(r.participant_name)} · ${escapeHtml(r.competition_name)} · ${escapeHtml(r.stage_name)}</p></div><div class="admin-reg-body"><div class="kv-grid">${kv}</div><div class="admin-status-box"><select id="adminSubmissionStatus" class="input">${['DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','REVISION','REJECTED'].map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}</select><textarea id="adminSubmissionNote" class="input" placeholder="Catatan untuk peserta...">${escapeHtml(r.admin_note||'')}</textarea><button class="btn primary" onclick="saveAdminSubmissionStatus('${r.submission_id}')">Simpan Status</button></div></div>`;
    openModal('adminSubmissionModal');
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function saveAdminSubmissionStatus(id){
  setLoading(true);try{
    await gs('adminUpdateSubmissionStatus',APP.token,id,val('adminSubmissionStatus'),val('adminSubmissionNote'));
    toast('Status karya diperbarui.');closeModal('adminSubmissionModal');
    await loadAdminSubmissionPage(APP.adminSubmissionPage?APP.adminSubmissionPage.page:1);
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function openAdminRegistration(id){
  setLoading(true);try{
    const d=await gs('adminGetRegistrationDetail',APP.token,id),r=d.registration,p=d.payload||{};
    const kv=Object.entries(p).map(([k,v])=>{let show='';if(v&&typeof v==='object'&&v.url)show=`<a href="${escapeAttr(v.url)}" target="_blank">${escapeHtml(v.fileName||'Buka file')}</a>`;else if(typeof v==='boolean')show=v?'Ya':'Tidak';else show=escapeHtml(String(v??''));return `<div class="kv"><span>${escapeHtml(humanize(k))}</span><b>${show||'-'}</b></div>`}).join('');
    document.getElementById('adminRegContent').innerHTML=`<div class="admin-reg-head"><span class="section-kicker">DETAIL PENDAFTARAN</span><h2>${escapeHtml(r.registration_id)}</h2><p class="form-subtitle" style="margin:0">${escapeHtml(r.participant_name)} · ${escapeHtml(r.competition_name)}</p></div><div class="admin-reg-body"><div class="kv-grid">${kv}</div><div class="admin-status-box"><select id="adminRegStatus" class="input">${['DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','REVISION','REJECTED','CANCELLED'].map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}</select><textarea id="adminRegNote" class="input" placeholder="Catatan verifikasi...">${escapeHtml(r.admin_note||'')}</textarea><button class="btn primary" onclick="saveAdminRegStatus('${r.registration_id}')">Simpan Status</button></div></div>`;
    openModal('adminRegModal');
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function saveAdminRegStatus(id){
  setLoading(true);try{
    const res=await gs('adminUpdateRegistrationStatus',APP.token,id,val('adminRegStatus'),val('adminRegNote'));
    APP.dashboard.stats=res.stats||APP.dashboard.stats;
    const ri=(APP.dashboard.recent||[]).findIndex(r=>r.registration_id===id);if(ri>=0)APP.dashboard.recent[ri]=res.registration;
    const pi=(APP.adminPage.rows||[]).findIndex(r=>r.registration_id===id);if(pi>=0)APP.adminPage.rows[pi]=res.registration;
    toast('Status diperbarui.');closeModal('adminRegModal');
    if(document.getElementById('adminTableBox'))document.getElementById('adminTableBox').innerHTML=renderAdminTable(APP.adminPage.rows||[]);
  }catch(e){handleSessionError(e)}finally{setLoading(false)}
}

async function renderAdminSystem(btn){
  setActiveMenu(btn);setDashTitle('ADMIN','Sistem & Database');
  const content=document.getElementById('dashboardContent');
  content.innerHTML='<div class="panel" style="margin-top:0"><div class="empty">Memuat informasi sistem...</div></div>';
  try{
    const info=await gs('adminGetSystemInfo',APP.token);
    content.innerHTML=`<div class="panel" style="margin-top:0">
      <div class="panel-head"><div><h3>Resource Google</h3><p class="form-subtitle" style="margin:3px 0 0">Sheet dan folder dibuat otomatis pada akses pertama deployment.</p></div></div>
      <div class="system-grid">
        <div class="system-item"><span>Spreadsheet Database</span><a href="${escapeAttr(info.spreadsheetUrl)}" target="_blank">Buka Spreadsheet ↗</a><b>${escapeHtml(info.spreadsheetId)}</b></div>
        <div class="system-item"><span>Folder Google Drive</span><a href="${escapeAttr(info.folderUrl)}" target="_blank">Buka Folder ↗</a><b>${escapeHtml(info.folderId)}</b></div>
        <div class="system-item"><span>Admin Awal</span><b>${escapeHtml(info.adminEmail)}</b></div>
        <div class="system-item"><span>Setup Terakhir</span><b>${info.setupAt?formatDateTime(info.setupAt):'-'}</b></div>
      </div>
      <div style="margin-top:18px"><span class="section-kicker">SHEET TERSEDIA</span><div class="sheet-chips">${(info.sheets||[]).map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div></div>
      <div class="file-box" style="margin-top:18px"><b>Catatan</b><div class="file-status">Password akun kini dikelola sepenuhnya oleh Firebase Authentication, bukan lagi disimpan/di-hash di sheet USERS. Sheet USERS hanya menyimpan profil dan Firebase uid.</div></div>
    </div>`;
  }catch(e){handleSessionError(e)}
}

function renderAccountSettings(btn){
  setActiveMenu(btn);setDashTitle('AKUN','Keamanan Akun');
  document.getElementById('dashboardContent').innerHTML=`<div class="panel password-box" style="margin-top:0">
    <div class="panel-head"><div><h3>Ganti Password</h3><p class="form-subtitle" style="margin:3px 0 0">Gunakan minimal delapan karakter.</p></div></div>
    <div class="field"><label>Password lama</label><input id="oldPassword" type="password" autocomplete="current-password"></div>
    <div class="field"><label>Password baru</label><input id="newPassword" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Ulangi password baru</label><input id="confirmPassword" type="password" autocomplete="new-password"></div>
    <button class="btn primary" onclick="saveMyPassword()">Simpan Password Baru</button>
    ${APP.user.role==='admin'?'<div class="file-box" style="margin-top:18px"><b>Admin default</b><div class="file-status">Akun admin awal dibuat otomatis pada deployment pertama. Setelah berhasil login, disarankan mengganti password dari halaman ini.</div></div>':''}
  </div>`;
}

// Password changes now go through Firebase directly (reauthenticate, then
// updatePassword) instead of a custom hash check on the GAS side.
async function saveMyPassword(){
  const oldP=val('oldPassword'),newP=val('newPassword'),confirmP=val('confirmPassword');
  if(newP.length<8){toast('Password baru minimal 8 karakter.',true);return}
  if(newP!==confirmP){toast('Konfirmasi password baru tidak sama.',true);return}
  setLoading(true);
  try{
    const user=firebaseAuth.currentUser;
    if(!user)throw new Error('Sesi Firebase tidak ditemukan, silakan masuk ulang.');
    const cred=firebase.auth.EmailAuthProvider.credential(user.email,oldP);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(newP);
    toast('Password berhasil diperbarui.');
    document.getElementById('oldPassword').value='';document.getElementById('newPassword').value='';document.getElementById('confirmPassword').value='';
  }catch(e){toast(mapAuthError(e),true)}finally{setLoading(false)}
}

function handleSessionError(e){
  const msg=e.message||String(e);if(msg.toLowerCase().includes('sesi')){APP.token='';APP.user=null;localStorage.removeItem('vectra_session');renderNav();goPublic();openAuth('login')}toast(msg,true)
}
function openModal(id){document.getElementById(id).classList.remove('hidden');document.body.style.overflow='hidden'}
function closeModal(id){document.getElementById(id).classList.add('hidden');document.body.style.overflow=''}
function closeModalOnBackdrop(e,id){if(e.target.id===id)closeModal(id)}
function setLoading(on){document.getElementById('loading').classList.toggle('hidden',!on)}
let toastTimer;function toast(msg,error=false){const t=document.getElementById('toast');t.textContent=msg;t.classList.toggle('error',!!error);t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3500)}
function val(id){const e=document.getElementById(id);return e?e.value.trim():''}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function escapeAttr(s){return escapeHtml(s).replace(/`/g,'&#96;')}
function humanize(s){return String(s).replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase())}
function formatDateTime(s){if(!s)return '-';try{return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(s))}catch(e){return s}}
function formatPeriod(a,b){if(!a&&b)return 'Jadwal menyusul';const f=x=>{if(!x)return '-';try{return new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(x+'T00:00:00'))}catch(e){return x}};return `${f(a)} – ${f(b)}`}
function scrollToCompetitions(){openPublicSection('kompetisi')}
function toggleMobileMenu(){document.getElementById('mobileLinks').classList.toggle('hidden')}
