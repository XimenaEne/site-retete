// State
let recipes = [];
let filteredRecipes = [];

// DOM Elements
const recipeGrid = document.getElementById('recipeGrid');
const searchInput = document.getElementById('searchInput');
const stats = document.getElementById('stats');
const modalOverlay = document.getElementById('recipeModal');
const closeModalBtn = document.getElementById('closeModal');
const modalTitle = document.getElementById('modalTitle');
const modalScroll = document.getElementById('modalScroll');
const modalHero = document.getElementById('modalHero');
const modalChips = document.getElementById('modalChips');
const modalHint = document.getElementById('modalHint');
const modalBody = document.getElementById('modalBody');
const ingredientsSection = document.getElementById('ingredientsSection');
const modalIngredients = document.getElementById('modalIngredients');
const modalPreparation = document.getElementById('modalPreparation');
const modalNotes = document.getElementById('modalNotes');
const ingCount = document.getElementById('ingCount');
const stepCount = document.getElementById('stepCount');
const modalImage = document.getElementById('modalImage');
const carouselControls = document.getElementById('carouselControls');
const prevImageBtn = document.getElementById('prevImage');
const nextImageBtn = document.getElementById('nextImage');
const imageIndicator = document.getElementById('imageIndicator');

const lightboxOverlay = document.getElementById('lightboxOverlay');
const closeLightboxBtn = document.getElementById('closeLightbox');
const lightboxImage = document.getElementById('lightboxImage');

let currentImages = [];
let currentImageIndex = 0;

// Textul rețetelor se afișează ca text, nu ca HTML (ex. „< 5 minute” nu strică pagina)
function escapeHtml(text) {
    return (text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// fără diacritice, ca „ciorba” să găsească și „ciorbă”
function normalize(text) {
    return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function getImages(recipe) {
    return (recipe.Imagine || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Initialize
async function init() {
    try {
        // Fetch and parse the CSV file
        // no-cache: vizitatorii văd imediat rețetele salvate din admin
        const response = await fetch('retete.csv', { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error('Nu am putut încărca fișierul retete.csv');
        }
        
        const csvText = await response.text();
        
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                // Show ONLY recipes explicitly marked as 'Publicat'
                recipes = results.data.filter(row => {
                    const hasData = row.Nume && row.Reteta;
                    const isPublished = row.Status === 'Publicat';
                    return hasData && isPublished;
                });
                
                // Sort alphabetically by name
                recipes.sort((a, b) => a.Nume.localeCompare(b.Nume));
                
                filteredRecipes = [...recipes];
                renderRecipes();
                updateStats();
            },
            error: function(error) {
                console.error("Eroare la parsarea CSV:", error);
                stats.innerHTML = `<span style="color: red;">Eroare la procesarea rețetelor. Verificați consola.</span>`;
            }
        });
    } catch (error) {
        console.error("Eroare:", error);
        stats.innerHTML = `<span style="color: red;">Eroare: Nu am găsit fișierul <strong>retete.csv</strong> în acest folder. Asigurați-vă că este încărcat corect pe GitHub.</span>`;
    }
}

// Render the grid
function renderRecipes() {
    recipeGrid.innerHTML = '';
    
    if (filteredRecipes.length === 0) {
        const searching = searchInput.value.trim() !== '';
        recipeGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #718096;">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 1rem; opacity: 0.5;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <h3 style="font-size: 1.5rem; margin-bottom: 0.5rem;">${searching ? 'Nu am găsit nicio rețetă' : 'Încă nu sunt rețete publicate'}</h3>
                <p>${searching ? 'Încearcă alte cuvinte cheie pentru căutare.' : 'Revino curând.'}</p>
            </div>
        `;
        return;
    }

    const fragment = document.createDocumentFragment();

    filteredRecipes.forEach(recipe => {
        const card = document.createElement('div');
        card.className = 'recipe-card';

        // pe card apare doar prima poză; restul se văd în rețetă
        const firstImage = getImages(recipe)[0];
        const imgHtml = firstImage ? `<div style="overflow: hidden;"><img src="${escapeHtml(firstImage)}" alt="${escapeHtml(recipe.Nume)}" class="recipe-img" loading="lazy"></div>` : '';

        card.innerHTML = `
            ${imgHtml}
            <div class="recipe-content">
                <h3 class="recipe-title">${escapeHtml(recipe.Nume)}</h3>
            </div>
        `;

        card.addEventListener('click', () => openModal(recipe));
        fragment.appendChild(card);
    });

    recipeGrid.appendChild(fragment);
}

// 1 rețetă, 5 rețete, 20 de rețete
function plural(n, one, many) {
    return `${n} ${n === 1 ? one : (n % 100 >= 20 ? 'de ' + many : many)}`;
}

// Update count
function updateStats() {
    stats.textContent = plural(filteredRecipes.length, 'rețetă', 'rețete');
}

// Search functionality
searchInput.addEventListener('input', (e) => {
    const searchTerm = normalize(e.target.value.trim());

    if (!searchTerm) {
        filteredRecipes = [...recipes];
    } else {
        filteredRecipes = recipes.filter(recipe => {
            const nameMatch = normalize(recipe.Nume).includes(searchTerm);
            const contentMatch = normalize(recipe.Reteta).includes(searchTerm);
            return nameMatch || contentMatch;
        });
    }
    
    renderRecipes();
    updateStats();
});

// ── Citirea textului rețetei ───────────────────────────────────────────────
// Textul are forma „Ingrediente: … Mod de preparare: …”
function splitRecipeText(text) {
    text = text || '';
    const prepMatch = /Mod de preparare:/i.exec(text);
    let ingredients = '';
    let prep = text;
    if (prepMatch) {
        ingredients = text.substring(0, prepMatch.index);
        prep = text.substring(prepMatch.index + prepMatch[0].length);
    }
    return { ingredients: ingredients.replace(/Ingrediente:/gi, ''), prep };
}

// cantitatea de la începutul rândului, ca s-o scriem îngroșat: „150 g”, „½ linguriță”, „un vârf”
const UNIT = '(?:kg|g|mg|ml|l|dl|cl|linguri(?:ță|țe)?|lingur[ăi]|căni|cană|pahare?|plicuri|plic|bucăți|buc\\.?|căței|cățel|felii|felie|legături|legătură|fire|fir|conserve?|pachete?|vârfuri|vârf|praf)';
const NUM  = '(?:~\\s*)?(?:\\d+(?:[.,]\\d+)?(?:\\s*[½¼¾⅓⅔])?(?:\\s*[–/-]\\s*\\d+(?:[.,]\\d+)?)?|[½¼¾⅓⅔])';
const QTY_RE = new RegExp(`^(${NUM}\\s*(?:${UNIT}(?=\\s|$))?|(?:un|o)\\s+${UNIT}(?=\\s|$))\\s*(.*)$`, 'i');
const LABEL_RE = /^([^:]{1,30}):\s+(.+)$/;   // „Umplutură: 400 g nucă, …”
const BULLET_RE = /^[•·*-]\s*/;
const NOTE_RE = /^(notă|note|nota|sursa|sfat)\b/i;

// grupuri de ingrediente: un rând care se termină cu „:” începe un grup nou („Pentru cremă:”)
function parseIngredients(text) {
    const groups = [];
    let current = null;
    text.split('\n').forEach(raw => {
        const line = raw.trim();
        if (!line) return;
        const isBullet = BULLET_RE.test(line);
        if (!isBullet && line.endsWith(':')) {
            current = { label: line.slice(0, -1).trim(), items: [] };
            groups.push(current);
            return;
        }
        if (!current) { current = { label: '', items: [] }; groups.push(current); }
        const item = line.replace(BULLET_RE, '');
        const q = QTY_RE.exec(item);
        const l = LABEL_RE.exec(item);
        if (q && q[2]) current.items.push({ qty: q[1].trim(), name: q[2] });
        else if (l) current.items.push({ qty: l[1].trim() + ':', name: l[2] });
        else current.items.push({ qty: '', name: item });
    });
    return groups.filter(g => g.items.length);
}

// pașii numerotați („1. …”); „Notă:”, „Sursa:” și ce vine după un rând gol, la final, merg la note
function parsePreparation(text) {
    const lines = text.split('\n').map(l => l.trim());
    const numbered = lines.some(l => /^\d+[.)]\s/.test(l));
    const steps = [];
    const notes = [];
    let afterBlank = false;
    let inNotes = false;
    lines.forEach(line => {
        if (!line) { afterBlank = true; return; }
        const m = /^\d+[.)]\s*(.*)$/.exec(line);
        if (m && NOTE_RE.test(m[1])) {
            notes.push(m[1]);
            inNotes = true;
        } else if (m) {
            steps.push(m[1]);
            inNotes = false;
        } else if (NOTE_RE.test(line) || inNotes) {
            notes.push(line);
            inNotes = true;
        } else if (numbered && steps.length) {
            steps[steps.length - 1] += '\n' + line;
        } else {
            steps.push(line.replace(BULLET_RE, ''));
        }
        afterBlank = false;
    });
    return { steps, notes };
}

const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';

function renderIngredients(groups) {
    return groups.map(g => `
        <div class="ing-group">
            ${g.label ? `<div class="ing-group-label">${escapeHtml(g.label)}</div>` : ''}
            <ul class="ing-list">
                ${g.items.map(it => `
                    <li><button type="button" class="ing-item" aria-pressed="false">
                        <span class="check">${CHECK_SVG}</span>
                        <span class="ing-text">${it.qty ? `<strong>${escapeHtml(it.qty)}</strong> ` : ''}${escapeHtml(it.name)}</span>
                    </button></li>`).join('')}
            </ul>
        </div>`).join('');
}

function stepLabel(n, done) {
    return done ? `Pasul ${n} e făcut – apasă ca să-l debifezi` : `Marchează pasul ${n} ca făcut`;
}

function renderSteps(steps) {
    return steps.map((s, i) => `
        <li class="step">
            <button type="button" class="step-num" aria-pressed="false" aria-label="${stepLabel(i + 1, false)}">
                <span class="num">${i + 1}</span>${CHECK_SVG}
            </button>
            <div class="step-content">
                ${s.split('\n').map(p => `<p>${escapeHtml(p)}</p>`).join('')}
            </div>
        </li>`).join('');
}

function renderNotes(notes) {
    if (!notes.length) return '';
    return `<h4>Note</h4>` + notes.map(n => /^sursa\b/i.test(n)
        ? `<p class="note-source">${escapeHtml(n)}</p>`
        : `<p>${escapeHtml(n.replace(/^(notă|note|nota)\s*:\s*/i, ''))}</p>`).join('');
}

function updateCounts() {
    const ing = modalIngredients.querySelectorAll('.ing-item');
    const ingDone = modalIngredients.querySelectorAll('.ing-item[aria-pressed="true"]');
    const steps = modalPreparation.querySelectorAll('.step-num');
    const stepsDone = modalPreparation.querySelectorAll('.step-num[aria-pressed="true"]');
    ingCount.textContent = ing.length ? `${ingDone.length} / ${ing.length} pregătite` : '';
    stepCount.textContent = steps.length > 1 ? `${stepsDone.length} / ${steps.length} făcuți` : '';
}

// bifarea ingredientelor și a pașilor
modalOverlay.addEventListener('click', (e) => {
    const btn = e.target.closest('.ing-item, .step-num');
    if (!btn) return;
    const done = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', done);
    if (btn.classList.contains('step-num')) {
        btn.closest('.step').classList.toggle('done', done);
        btn.setAttribute('aria-label', stepLabel(btn.textContent.trim(), done));
    }
    updateCounts();
});

// Modal Logic
function openModal(recipe) {
    modalTitle.textContent = recipe.Nume;

    const parts = splitRecipeText(recipe.Reteta);
    const groups = parseIngredients(parts.ingredients);
    const { steps, notes } = parsePreparation(parts.prep);
    const nIng = groups.reduce((sum, g) => sum + g.items.length, 0);

    modalIngredients.innerHTML = renderIngredients(groups);
    modalPreparation.innerHTML = renderSteps(steps);
    modalNotes.innerHTML = renderNotes(notes);
    modalNotes.style.display = notes.length ? '' : 'none';
    ingredientsSection.style.display = nIng ? '' : 'none';
    modalBody.classList.toggle('no-ingredients', !nIng);

    const chips = [];
    if (nIng) chips.push(plural(nIng, 'ingredient', 'ingrediente'));
    if (steps.length > 1) chips.push(plural(steps.length, 'pas', 'pași'));
    modalChips.innerHTML = chips.map(c => `<span>${c}</span>`).join('');
    modalHint.style.display = nIng || steps.length > 1 ? '' : 'none';
    updateCounts();
    modalScroll.scrollTop = 0;

    // Handle images
    currentImages = getImages(recipe);

    if (currentImages.length > 0) {
        currentImageIndex = 0;
        updateModalImage();
        modalImage.alt = recipe.Nume;
        modalHero.classList.remove('no-image');
        if (currentImages.length > 1) {
            carouselControls.style.display = 'flex';
        } else {
            carouselControls.style.display = 'none';
        }
    } else {
        modalHero.classList.add('no-image');
        carouselControls.style.display = 'none';
    }
    
    modalOverlay.classList.add('active');
    document.documentElement.classList.add('no-scroll');
    // un pas în istoric, ca butonul Back de pe telefon să închidă rețeta, nu site-ul
    history.pushState({ layer: 'modal' }, '', '#modal');
}

function updateModalImage() {
    modalImage.src = currentImages[currentImageIndex];
    imageIndicator.textContent = `${currentImageIndex + 1} / ${currentImages.length}`;
}

prevImageBtn.addEventListener('click', () => {
    if (currentImages.length <= 1) return;
    currentImageIndex = (currentImageIndex - 1 + currentImages.length) % currentImages.length;
    updateModalImage();
});

nextImageBtn.addEventListener('click', () => {
    if (currentImages.length <= 1) return;
    currentImageIndex = (currentImageIndex + 1) % currentImages.length;
    updateModalImage();
});

// Rețeta și poza mărită au fiecare câte un pas în istoric, așa că orice închidere
// (X, click alături, Escape) trece prin history.back(); popstate închide stratul de sus.
// Astfel Back pe telefon închide întâi poza, apoi rețeta, și abia apoi iese din site.
function closeModal() {
    history.back();
}

function closeLightbox() {
    history.back();
}

window.addEventListener('popstate', () => {
    if (lightboxOverlay.classList.contains('active')) {
        lightboxOverlay.classList.remove('active');
    } else if (modalOverlay.classList.contains('active')) {
        modalOverlay.classList.remove('active');
        document.documentElement.classList.remove('no-scroll');
    }
});

closeModalBtn.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        closeModal();
    }
});

// Escape închide întâi poza mărită, apoi rețeta
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (lightboxOverlay.classList.contains('active')) {
        closeLightbox();
    } else if (modalOverlay.classList.contains('active')) {
        closeModal();
    }
});

// Lightbox Logic
modalImage.addEventListener('click', () => {
    if (!modalImage.src || modalImage.src.includes('undefined')) return;
    lightboxImage.src = modalImage.src;
    lightboxOverlay.classList.add('active');
    history.pushState({ layer: 'lightbox' }, '', '#poza');
});

closeLightboxBtn.addEventListener('click', closeLightbox);

lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) {
        closeLightbox();
    }
});

// Start app
document.addEventListener('DOMContentLoaded', init);
