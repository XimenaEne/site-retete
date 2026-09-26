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
const modalSource = document.getElementById('modalSource');
const modalIngredients = document.getElementById('modalIngredients');
const modalPreparation = document.getElementById('modalPreparation');
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

// Update count
// 1 rețetă, 5 rețete, 20 de rețete
function updateStats() {
    const n = filteredRecipes.length;
    const label = n === 1 ? 'rețetă' : (n % 100 >= 20 ? 'de rețete' : 'rețete');
    stats.textContent = `${n} ${label}`;
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

function formatRecipeText(text) {
    if (!text) return { ingredients: '', prep: '' };
    text = escapeHtml(text);

    let ingredients = '';
    let prep = text;
    
    const prepMatch = /Mod de preparare:/i.exec(text);
    const ingMatch = /Ingrediente:/i.exec(text);
    
    if (prepMatch) {
        if (ingMatch && ingMatch.index < prepMatch.index) {
            ingredients = text.substring(ingMatch.index, prepMatch.index).trim();
            prep = text.substring(prepMatch.index).trim();
        } else {
            prep = text.substring(prepMatch.index).trim();
            ingredients = text.substring(0, prepMatch.index).trim();
        }
    } else {
        ingredients = '';
        prep = text.trim();
    }
    
    ingredients = ingredients.replace(/Ingrediente:\s*/gi, '<div class="recipe-section-title">Ingrediente</div>');
    prep = prep.replace(/Mod de preparare:\s*/gi, '<div class="recipe-section-title">Mod de preparare</div>');
    
    return { ingredients, prep };
}

// Modal Logic
function openModal(recipe) {
    modalTitle.textContent = recipe.Nume;
    
    const splitText = formatRecipeText(recipe.Reteta);
    modalIngredients.innerHTML = splitText.ingredients;
    modalPreparation.innerHTML = splitText.prep;
    
    // Handle images
    currentImages = getImages(recipe);

    if (currentImages.length > 0) {
        currentImageIndex = 0;
        updateModalImage();
        modalImage.style.display = 'block';
        if (currentImages.length > 1) {
            carouselControls.style.display = 'flex';
        } else {
            carouselControls.style.display = 'none';
        }
    } else {
        modalImage.style.display = 'none';
        carouselControls.style.display = 'none';
    }
    
    modalOverlay.classList.add('active');
    document.documentElement.classList.add('no-scroll');
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

function closeModal() {
    modalOverlay.classList.remove('active');
    document.documentElement.classList.remove('no-scroll');
}

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
        lightboxOverlay.classList.remove('active');
    } else if (modalOverlay.classList.contains('active')) {
        closeModal();
    }
});

// Lightbox Logic
modalImage.addEventListener('click', () => {
    if (!modalImage.src || modalImage.src.includes('undefined')) return;
    lightboxImage.src = modalImage.src;
    lightboxOverlay.classList.add('active');
});

closeLightboxBtn.addEventListener('click', () => {
    lightboxOverlay.classList.remove('active');
});

lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) {
        lightboxOverlay.classList.remove('active');
    }
});

// Start app
document.addEventListener('DOMContentLoaded', init);
