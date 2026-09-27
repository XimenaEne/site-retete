// ── State ──────────────────────────────────────────────────────────────────
const CSV_FILE = 'retete.csv';
let gh = loadGhConfig();   // { owner, repo, token }
let csvSha       = '';     // versiunea lui retete.csv de pe GitHub (necesară la salvare)
let csvFields    = [];
let recipesData  = [];
let editingIndex = null;
let editNewFiles = [];
let editImages   = [];     // pozele rețetei din fereastra de editare, până la salvare
const localPreviews = {};  // imagini urcate acum, care încă nu au apărut pe site

// ── GitHub config ──────────────────────────────────────────────────────────
function loadGhConfig() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ghConfig') || '{}'); } catch (e) {}
    const guess = guessRepoFromUrl();
    return {
        owner: saved.owner || guess.owner || 'XimenaEne',
        repo:  saved.repo  || guess.repo  || 'site-retete',
        token: saved.token || ''
    };
}

function saveGhConfig() {
    try { localStorage.setItem('ghConfig', JSON.stringify(gh)); } catch (e) {}
}

// Pe GitHub Pages adresa e https://<owner>.github.io/<repo>/admin.html
function guessRepoFromUrl() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return { owner: '', repo: '' };
    const first = location.pathname.split('/').filter(Boolean)[0] || '';
    return { owner: m[1], repo: (!first || first.endsWith('.html')) ? location.hostname : first };
}

function logout(reason) {
    gh.token = '';
    saveGhConfig();
    showLoginScreen(reason);
}

// ── GitHub API helpers ─────────────────────────────────────────────────────
async function ghFetch(path, method = 'GET', body = null) {
    const opts = {
        method,
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${gh.token}` }
    };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res  = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;

    let message = data.message || `GitHub a răspuns cu eroarea ${res.status}`;
    if (res.status === 401) message = 'Cheia GitHub nu mai este validă (poate a expirat).';
    if (res.status === 403) message = 'Cheia GitHub nu are drept de scriere. Generează una cu „Contents: Read and write”.';
    if (res.status === 404) message = `Nu găsesc ${path.replace('/contents/', '')} în ${gh.owner}/${gh.repo} (sau cheia nu are acces la acest repository).`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
}

async function putFile(path, content, message, sha) {
    const body = { message, content };
    if (sha) body.sha = sha;
    for (let attempt = 1; ; attempt++) {
        try {
            return await ghFetch(`/contents/${path}`, 'PUT', body);
        } catch (err) {
            // GitHub răspunde uneori cu 409 când două salvări vin foarte repede una după alta
            if (err.status !== 409 || attempt === 3) throw err;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
}

function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

function base64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const loadingOverlay   = document.getElementById('loadingOverlay');
const loadingText      = document.getElementById('loadingText');
const alertBox         = document.getElementById('alertBox');
const serverStatus     = document.getElementById('serverStatus');
const pendingBadge     = document.getElementById('pendingBadge');
const approvedBadge    = document.getElementById('approvedBadge');
const pendingList      = document.getElementById('pendingList');
const pendingSearch    = document.getElementById('pendingSearch');
const approvedList     = document.getElementById('approvedList');
const editModalOverlay = document.getElementById('editModalOverlay');
const editNume         = document.getElementById('editNume');
const editIngrediente  = document.getElementById('editIngrediente');
const editPreparare    = document.getElementById('editPreparare');
const editImgGrid      = document.getElementById('editImgGrid');
const editImagineInput = document.getElementById('editImagine');
const editUploadPreview= document.getElementById('editUploadPreview');
const approveEditBtn   = document.getElementById('approveEditBtn');

// ── Helpers ────────────────────────────────────────────────────────────────
function showLoading(t) { loadingText.textContent = t || 'Se procesează...'; loadingOverlay.classList.add('visible'); }
function hideLoading()   { loadingOverlay.classList.remove('visible'); }

function showAlert(msg, type = 'success') {
    alertBox.textContent = msg;
    alertBox.className = `alert alert-${type} visible`;
    clearTimeout(showAlert._t);
    showAlert._t = setTimeout(() => alertBox.classList.remove('visible'), type === 'error' ? 9000 : 4500);
}

function imgSrc(path) { return localPreviews[path] || path; }

function getImages(r) { return (r.Imagine || '').split(',').map(s => s.trim()).filter(Boolean); }

function escapeHtml(text) {
    return (text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'pending')  renderPending();
        if (btn.dataset.tab === 'approved') renderApproved();
    });
});

// ── Load recipes from GitHub ───────────────────────────────────────────────
async function loadRecipes() {
    showLoading('Se citesc rețetele din GitHub...');
    try {
        const file = await ghFetch(`/contents/${CSV_FILE}`);
        csvSha = file.sha;
        const parsed = Papa.parse(base64ToUtf8(file.content), { header: true, skipEmptyLines: true });
        csvFields   = parsed.meta.fields || [];
        recipesData = parsed.data;
        recipesData.forEach(r => {
            if (!r.Status)  r.Status  = 'In Asteptare';
            if (!r.Imagine) r.Imagine = '';
        });
        serverStatus.textContent = `${gh.owner}/${gh.repo} — ${recipesData.length} rețete`;
        updateBadges();
        renderPending();
        hideLoading();
    } catch (err) {
        console.error(err);
        hideLoading();
        if (err.status === 401) logout(err.message);
        else showAlert('Nu s-au putut citi rețetele din GitHub: ' + err.message, 'error');
    }
}

// ── Save all to GitHub ─────────────────────────────────────────────────────
function buildCsv() {
    const fields = [...csvFields];
    for (const col of ['Status', 'Imagine']) {
        if (!fields.includes(col)) fields.push(col);
    }
    const rows = recipesData.map(r => fields.map(f => r[f] ?? ''));
    return Papa.unparse({ fields, data: rows }, { quotes: true, newline: '\r\n' }) + '\r\n';
}

async function saveRecipes(msg) {
    msg = msg || 'Modificările au fost salvate!';
    showLoading('Se salvează în GitHub...');
    try {
        const res = await putFile(CSV_FILE, utf8ToBase64(buildCsv()), msg, csvSha);
        csvSha = res.content.sha;
        showAlert(`${msg} Site-ul se actualizează în 1-2 minute.`);
        return true;
    } catch (err) {
        console.error(err);
        if (err.status === 401) { logout(err.message); return false; }
        if (err.status === 409) err.message = 'Rețetele au fost modificate între timp de pe alt dispozitiv. Reîncarcă pagina și refă modificarea.';
        showAlert('Eroare la salvare: ' + err.message, 'error');
        return false;
    } finally {
        hideLoading();
    }
}

// ── Upload image to GitHub ─────────────────────────────────────────────────
function fileToBase64Image(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height, MAX = 1200;
                if (w > h && w > MAX) { h = h * MAX / w; w = MAX; }
                else if (h >= w && h > MAX) { w = w * MAX / h; h = MAX; }
                canvas.width = Math.round(w); canvas.height = Math.round(h);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                // Safari (iPhone) nu știe să creeze WEBP — acolo folosim JPEG
                let dataUrl = canvas.toDataURL('image/webp', 0.82);
                let ext = 'webp';
                if (!dataUrl.startsWith('data:image/webp')) { dataUrl = canvas.toDataURL('image/jpeg', 0.85); ext = 'jpg'; }
                let enc = dataUrl.replace(/^data:(.*,)?/, '');
                if (enc.length % 4 > 0) enc += '='.repeat(4 - enc.length % 4);
                resolve({ content: enc, ext });
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
    });
}

async function uploadImages(files, baseName) {
    const urls = [];
    for (const [n, file] of files.entries()) {
        showLoading(`Se încarcă imaginea ${n + 1} din ${files.length}...`);
        const { content, ext } = await fileToBase64Image(file);
        const safeName = normalize(baseName).replace(/[^a-z0-9]/g, '-')
            + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5) + '.' + ext;
        const path = `imagini/${safeName}`;
        await putFile(path, content, `Imagine nouă pentru „${baseName}”`);
        localPreviews[path] = URL.createObjectURL(file);
        urls.push(path);
    }
    return urls;
}

// ── Badges ─────────────────────────────────────────────────────────────────
function updateBadges() {
    pendingBadge.textContent  = recipesData.filter(r => r.Status === 'In Asteptare' && r.Nume).length;
    approvedBadge.textContent = recipesData.filter(r => r.Status === 'Publicat'     && r.Nume).length;
}

// ── Render helpers ─────────────────────────────────────────────────────────
function getThumb(r) {
    const first = getImages(r)[0];
    if (!first) return `<div class="recipe-item-no-img">🍽️</div>`;
    return `<img class="recipe-item-thumb" src="${escapeHtml(imgSrc(first))}" onerror="this.style.display='none'" alt="">`;
}

function renderList(container, items) {
    if (!items.length) {
        container.innerHTML = `<div class="empty-state"><div class="icon">🍃</div><p>Nicio rețetă aici.</p></div>`;
        return;
    }
    container.innerHTML = `<div class="recipe-list">${items.map(({ r, i }) => `
        <div class="recipe-item">
            ${getThumb(r)}
            <div class="recipe-item-name">${escapeHtml(r.Nume) || '(fără nume)'}</div>
            <span class="badge ${r.Status === 'Publicat' ? 'badge-approved' : 'badge-pending'}">
                ${r.Status === 'Publicat' ? '✔ Publicat' : '⏳ În așteptare'}
            </span>
            <div class="recipe-item-actions">
                ${r.Status === 'Publicat'
                    ? `<button class="btn btn-sm" style="background:#eee;color:#555;" onclick="moveToWaiting(${i})">⏳ Retrage</button>`
                    : ''}
                <button class="btn btn-sm" style="background:#eee;color:#555;" onclick="openEditModal(${i})">✏ Editează</button>
                <button class="btn btn-danger btn-sm" onclick="deleteRecipe(${i})">🗑 Șterge</button>
            </div>
        </div>`).join('')}</div>`;
}

// fără diacritice, ca „ciorba” să găsească și „ciorbă”
function normalize(text) {
    return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function renderPending()  {
    const term = normalize(pendingSearch.value.trim());
    renderList(pendingList,  recipesData.map((r,i)=>({r,i})).filter(({r})=>r.Status==='In Asteptare'&&r.Nume
        && (!term || normalize(r.Nume).includes(term) || normalize(r.Reteta).includes(term))));
}
pendingSearch.addEventListener('input', renderPending);
function renderApproved() {
    renderList(approvedList, recipesData.map((r,i)=>({r,i})).filter(({r})=>r.Status==='Publicat'&&r.Nume));
}

// ── Actions ────────────────────────────────────────────────────────────────
// Fiecare acțiune se salvează imediat în GitHub; dacă salvarea nu reușește, se anulează
function refreshLists() { updateBadges(); renderPending(); renderApproved(); }

async function setStatus(i, status, msg) {
    const r = recipesData[i];
    const previous = r.Status;
    r.Status = status;
    refreshLists();
    if (!await saveRecipes(msg)) { r.Status = previous; refreshLists(); }
}

function moveToWaiting(i)   { setStatus(i, 'In Asteptare', `"${recipesData[i].Nume}" retrasă de pe site.`); }

async function deleteRecipe(i) {
    const r = recipesData[i];
    if (!confirm(`Ștergi "${r.Nume}"?`)) return;
    recipesData.splice(i, 1);
    refreshLists();
    if (!await saveRecipes(`"${r.Nume}" ștearsă.`)) { recipesData.splice(i, 0, r); refreshLists(); }
}
document.getElementById('logoutBtn').addEventListener('click', () => {
    if (confirm('Ieși din admin pe acest dispozitiv? Va trebui să introduci din nou cheia GitHub.')) logout();
});

// ── Import rețetă dintr-un link extern (fără AI) ────────────────────────────
// Citirea paginii se face pe server (funcția din api/extract-recipe.js, pe
// Vercel), nu în browser — așa nu ne mai lovim de CORS și nu mai depindem de
// proxy-uri publice nesigure. Vezi api/extract-recipe.js pentru cum extrage
// datele (JSON-LD schema.org/Recipe, puse de bloguri pentru Google/Pinterest).
const RECIPE_API_URL = 'https://site-retete.vercel.app/api/extract-recipe';

const RECIPE_API_TIMEOUT_MS = 15000;

async function importRecipeFromUrl(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Adresa trebuie să înceapă cu http:// sau https://');
    if (RECIPE_API_URL.startsWith('PASTE_AICI')) {
        throw new Error('RECIPE_API_URL din admin.js nu e completat încă cu adresa de pe Vercel.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RECIPE_API_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(`${RECIPE_API_URL}?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    } catch (err) {
        throw new Error(err.name === 'AbortError' ? 'Scriptul de extragere nu a răspuns la timp.' : 'Nu am putut contacta scriptul de extragere: ' + err.message);
    } finally {
        clearTimeout(timeoutId);
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error(`Răspuns invalid de la scriptul de extragere (${res.status}).`);
    if (!res.ok || data.error) throw new Error(data.error || `Eroare la extragere (${res.status}).`);
    return data; // { nume, ingrediente, preparare }
}

document.getElementById('importUrlBtn').addEventListener('click', async () => {
    const url = document.getElementById('importUrl').value.trim();
    if (!url) { showAlert('Lipește mai întâi un link.', 'error'); return; }

    showLoading('Se extrage rețeta din pagină...');
    try {
        const extracted = await importRecipeFromUrl(url);
        if (extracted.nume)        document.getElementById('addNume').value = extracted.nume;
        if (extracted.ingrediente) document.getElementById('addIngrediente').value = extracted.ingrediente;
        if (extracted.preparare)   document.getElementById('addPreparare').value = extracted.preparare;
        showAlert('Rețetă extrasă! Verifică textul și adaugă tu poza.', 'success');
    } catch (err) {
        console.error(err);
        showAlert(err.message || 'Nu am putut extrage rețeta din acest link.', 'error');
    } finally {
        hideLoading();
    }
});

// ── Add New Recipe ─────────────────────────────────────────────────────────
document.getElementById('addImagine').addEventListener('change', function() {
    const preview = document.getElementById('addUploadPreview');
    preview.innerHTML = '';
    Array.from(this.files).forEach(f => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        preview.appendChild(img);
    });
});

async function addRecipe(publish) {
    const nume       = document.getElementById('addNume').value.trim();
    const ingrediente = document.getElementById('addIngrediente').value.trim();
    const preparare   = document.getElementById('addPreparare').value.trim();
    const files       = Array.from(document.getElementById('addImagine').files);

    if (!nume || !ingrediente || !preparare) {
        showAlert('Numele, ingredientele și modul de preparare sunt obligatorii!', 'error'); return;
    }

    try {
        let imgUrls = [];
        if (files.length) imgUrls = await uploadImages(files, nume);

        const retetaText = `Ingrediente:\n${ingrediente}\n\nMod de preparare:\n${preparare}`;
        const recipe = { Nume: nume, Reteta: retetaText, Imagine: imgUrls.join(','),
                         Status: publish ? 'Publicat' : 'In Asteptare' };
        recipesData.push(recipe);

        if (!await saveRecipes(publish ? `"${nume}" publicată pe site!` : `"${nume}" adăugată în așteptare!`)) {
            // formularul rămâne completat, ca să poți încerca din nou
            recipesData.splice(recipesData.indexOf(recipe), 1);
            return;
        }
        refreshLists();

        document.getElementById('addNume').value = '';
        document.getElementById('addIngrediente').value = '';
        document.getElementById('addPreparare').value = '';
        document.getElementById('addImagine').value = '';
        document.getElementById('addUploadPreview').innerHTML = '';
    } catch (err) {
        console.error(err);
        showAlert('Eroare: ' + err.message, 'error');
    }
    hideLoading();
}
document.getElementById('submitRecipeBtn').addEventListener('click',  () => addRecipe(false));
document.getElementById('publishRecipeBtn').addEventListener('click', () => addRecipe(true));

// ── Edit Modal ─────────────────────────────────────────────────────────────
function openEditModal(index) {
    editingIndex = index;
    editNewFiles = [];
    const r = recipesData[index];

    editNume.value = r.Nume || '';

    const text     = r.Reteta || '';
    const prepIdx  = text.search(/Mod de preparare:/i);
    const ingIdx   = text.search(/Ingrediente:/i);
    if (prepIdx !== -1) {
        const ingRaw  = ingIdx !== -1 ? text.substring(ingIdx, prepIdx) : text.substring(0, prepIdx);
        editIngrediente.value = ingRaw.replace(/Ingrediente:\s*/i, '').trim();
        editPreparare.value   = text.substring(prepIdx).replace(/Mod de preparare:\s*/i, '').trim();
    } else {
        editIngrediente.value = text;
        editPreparare.value   = '';
    }

    editImages = getImages(r);
    renderEditImages();

    editUploadPreview.innerHTML = '';
    editImagineInput.value = '';
    approveEditBtn.classList.toggle('hidden', r.Status === 'Publicat');

    editModalOverlay.classList.add('active');
    document.documentElement.style.overflow = 'hidden';
}

// Pozele se schimbă doar în fereastră; rețeta se modifică abia la salvare
function renderEditImages() {
    if (!editImages.length) {
        editImgGrid.innerHTML = '<em style="color:var(--text-secondary);font-size:0.9rem;">Nicio imagine</em>';
        return;
    }
    editImgGrid.innerHTML = editImages.map((src, i) =>
        `<div class="img-edit-item">
            <img src="${escapeHtml(imgSrc(src))}" onerror="this.style.opacity=0.3" alt="">
            <button class="img-edit-remove" data-i="${i}" title="Șterge">✕</button>
         </div>`).join('');
    editImgGrid.querySelectorAll('.img-edit-remove').forEach(btn => {
        btn.addEventListener('click', function() {
            editImages.splice(parseInt(this.dataset.i), 1);
            renderEditImages();
        });
    });
}

editImagineInput.addEventListener('change', function() {
    editNewFiles = Array.from(this.files);
    editUploadPreview.innerHTML = '';
    editNewFiles.forEach(f => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        editUploadPreview.appendChild(img);
    });
});

function closeModal() {
    editModalOverlay.classList.remove('active');
    document.documentElement.style.overflow = '';
    editingIndex = null; editNewFiles = [];
}
document.getElementById('closeEditModal').addEventListener('click',  closeModal);
document.getElementById('cancelEditBtn').addEventListener('click',   closeModal);
editModalOverlay.addEventListener('click', e => { if (e.target === editModalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function saveEdit(approve) {
    if (editingIndex === null) return;
    const nume = editNume.value.trim();
    if (!nume) { showAlert('Rețeta trebuie să aibă un nume!', 'error'); return; }

    const r = recipesData[editingIndex];
    const before = { ...r };   // dacă salvarea nu reușește, rețeta rămâne neschimbată
    let saved = false;
    try {
        const images = [...editImages];
        if (editNewFiles.length) images.push(...await uploadImages(editNewFiles, nume));
        r.Nume    = nume;
        r.Reteta  = `Ingrediente:\n${editIngrediente.value.trim()}\n\nMod de preparare:\n${editPreparare.value.trim()}`;
        r.Imagine = images.join(',');
        if (approve) r.Status = 'Publicat';
        saved = await saveRecipes(approve ? `"${nume}" aprobată și publicată!` : `"${nume}" actualizată!`);
    } catch (err) {
        console.error(err);
        showAlert('Eroare: ' + err.message, 'error');
    }
    if (!saved) Object.assign(r, before);
    refreshLists();
    if (saved) closeModal();
    hideLoading();
}
document.getElementById('saveEditBtn').addEventListener('click',    () => saveEdit(false));
document.getElementById('approveEditBtn').addEventListener('click', () => saveEdit(true));

// ── Login Screen ───────────────────────────────────────────────────────────
function showLoginScreen(message = '') {
    document.body.innerHTML = `
        <style>
            .login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#F5F2EC; padding:1rem; }
            .login-box { background:#FDFCF9; border:1px solid #E0DDD5; padding:3.5rem 3rem; width:100%; max-width:420px; text-align:center; }
            .login-box h1 { font-family:'Playfair Display',serif; font-style:italic; color:#1C3B2B; font-size:2rem; margin:0 0 0.5rem; }
            .login-box p { color:#8a8070; font-size:0.85rem; letter-spacing:2px; text-transform:uppercase; margin:0 0 2.5rem; }
            .login-box input { width:100%; padding:0.9rem 1rem; border:1px solid #E0DDD5; margin-bottom:1rem; font-family:'Outfit',sans-serif; font-size:1rem; background:white; color:#2C1E16; border-radius:2px; box-sizing:border-box; }
            .login-box input:focus { outline:none; border-color:#C7A977; }
            .login-box .repo-row { display:flex; gap:0.5rem; }
            .login-box button { width:100%; padding:1rem; background:#1C3B2B; color:#C7A977; border:none; font-family:'Outfit',sans-serif; font-weight:700; letter-spacing:2px; text-transform:uppercase; font-size:0.85rem; cursor:pointer; border-radius:2px; transition:0.2s; }
            .login-box button:hover { background:#24503b; }
            .login-box button:disabled { opacity:0.6; cursor:wait; }
            .login-hint { color:#8a8070; font-size:0.8rem; margin-top:1.2rem; line-height:1.5; }
            .login-hint a { color:#1C3B2B; }
            .login-err { color:#c0392b; font-size:0.9rem; margin-top:1rem; min-height:1.2em; }
            @media (max-width: 480px) { .login-box { padding:2.5rem 1.5rem; } }
        </style>
        <div class="login-wrap">
            <div class="login-box">
                <h1>Colecția Ximenei</h1>
                <p>Acces Restricționat</p>
                <div class="repo-row">
                    <input type="text" id="loginOwner" placeholder="Utilizator GitHub" autocomplete="off" autocapitalize="off">
                    <input type="text" id="loginRepo" placeholder="Repository" autocomplete="off" autocapitalize="off">
                </div>
                <input type="password" id="loginToken" placeholder="Cheia secretă GitHub (token)" autocomplete="current-password">
                <button id="loginBtn">Intră</button>
                <div class="login-err" id="loginErr"></div>
                <div class="login-hint">Cheia se păstrează doar pe acest dispozitiv.<br>
                    <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Generează o cheie nouă</a></div>
            </div>
        </div>`;

    const ownerInput = document.getElementById('loginOwner');
    const repoInput  = document.getElementById('loginRepo');
    const tokenInput = document.getElementById('loginToken');
    const loginBtn   = document.getElementById('loginBtn');
    const loginErr   = document.getElementById('loginErr');
    ownerInput.value = gh.owner;
    repoInput.value  = gh.repo;
    loginErr.textContent = message;

    const doLogin = async () => {
        const candidate = { owner: ownerInput.value.trim(), repo: repoInput.value.trim(), token: tokenInput.value.trim() };
        if (!candidate.owner || !candidate.repo || !candidate.token) {
            loginErr.textContent = 'Completează toate câmpurile.'; return;
        }
        loginErr.textContent = '';
        loginBtn.disabled = true;
        const previous = gh;
        gh = candidate;
        try {
            await ghFetch(`/contents/${CSV_FILE}`);   // verifică cheia, repo-ul și existența fișierului
            saveGhConfig();
            location.reload();
        } catch (e) {
            gh = previous;
            loginErr.textContent = e.status ? e.message : 'Nu mă pot conecta la GitHub. Verifică internetul.';
            loginBtn.disabled = false;
        }
    };

    loginBtn.addEventListener('click', doLogin);
    document.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

// ── Boot ───────────────────────────────────────────────────────────────────
if (gh.token && gh.owner && gh.repo) {
    loadRecipes();
} else {
    showLoginScreen();
}
