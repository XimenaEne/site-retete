// ── Extrage o rețetă (schema.org/Recipe) dintr-un link extern ───────────────
// Rulează pe server (Vercel), nu în browser — de-aia nu ne mai lovim de CORS și
// nu mai depindem de proxy-uri publice nesigure. Citește doar date structurate
// (JSON-LD) pe care blogurile le pun deja în pagină pentru Google/Pinterest.
// Fără AI, fără costuri.

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const targetUrl = req.query.url;
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        res.status(400).json({ error: 'Lipsește parametrul "url" sau nu e o adresă validă.' });
        return;
    }

    let html;
    try {
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeImporter/1.0)' }
        });
        if (!response.ok) {
            res.status(502).json({ error: `Pagina a răspuns cu ${response.status}` });
            return;
        }
        html = await response.text();
    } catch (err) {
        res.status(502).json({ error: 'Nu am putut accesa pagina: ' + err.message });
        return;
    }

    const recipe = extractRecipe(html);
    if (!recipe) {
        res.status(404).json({ error: 'Nu am găsit o rețetă recunoscută pe această pagină.' });
        return;
    }
    res.status(200).json(recipe);
};

function extractRecipe(html) {
    const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRe.exec(html))) {
        let data;
        try { data = JSON.parse(match[1].trim()); } catch (e) { continue; }
        const recipe = findRecipeInJsonLd(data);
        if (recipe) return buildResult(recipe);
    }
    return null;
}

// caută recursiv un obiect cu "@type": "Recipe" — poate fi direct, într-un
// array, sau ascuns într-un „@graph”
function findRecipeInJsonLd(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findRecipeInJsonLd(item);
            if (found) return found;
        }
        return null;
    }
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some(t => typeof t === 'string' && t.toLowerCase() === 'recipe')) return node;
    if (node['@graph']) return findRecipeInJsonLd(node['@graph']);
    return null;
}

// „recipeInstructions” poate fi text simplu, listă de texte, listă de HowToStep
// sau secțiuni HowToSection cu pași imbricați — le aducem pe toate la o listă de texte
function flattenInstructions(value) {
    if (!value) return [];
    if (typeof value === 'string') return value.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (Array.isArray(value)) return value.flatMap(flattenInstructions);
    if (typeof value === 'object') {
        if (value.itemListElement) return flattenInstructions(value.itemListElement);
        if (value.text) return [String(value.text).trim()];
        if (value.name) return [String(value.name).trim()];
    }
    return [];
}

function normalizeIngredientList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return [String(value).trim()];
}

function buildResult(recipe) {
    const ingrediente = normalizeIngredientList(recipe.recipeIngredient);
    const steps = flattenInstructions(recipe.recipeInstructions);
    return {
        nume: (recipe.name || '').toString().trim(),
        ingrediente: ingrediente.join('\n'),
        preparare: steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    };
}
