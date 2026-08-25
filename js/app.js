// ---- DATA ----
// techniques and recipes are fetched from data/*.json at startup — that's
// the actual "database." Edit those .json files directly to add or change
// content, no JavaScript knowledge required.
let techniques = {};
let recipes = {};

async function loadData() {
  const [techRes, recRes] = await Promise.all([
    fetch('data/techniques.json'),
    fetch('data/recipes.json')
  ]);
  techniques = await techRes.json();
  recipes = await recRes.json();
}

// Preferred display order for categories; anything not listed here is
// appended alphabetically after these. Easy to extend as new categories
// show up in the data.
const CATEGORY_ORDER = ['Breakfast', 'Mains', 'Sauces & Dressings', 'Desserts'];

// ---- STATE ----
let appState = {
  view: 'browse',        // 'browse' | 'cook'
  browseMode: 'category', // 'category' | 'technique'
  searchQuery: ''
};
let currentRecipeId = null;
let depthLevel = 1;          // default: Standard, global across all steps
let panelOpenState = [];     // per-step booleans in cook view, reset per recipe
let ingredientDropdownOpen = {}; // recipeId -> bool, for browse-screen dropdowns
let savedProgress = null;    // { recipeId, stepIndex } | null — for resume banner
let lastSavedStepIndex = -1; // avoids writing to storage on every scroll tick

function currentRecipe() { return recipes[currentRecipeId]; }

// ---- FORMATTING HELPERS ----
const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.3333: '⅓', 0.6667: '⅔', 0.125: '⅛', 0.375: '⅜', 0.625: '⅝', 0.875: '⅞' };

function formatAmount(n) {
  if (n === null || n === undefined) return '';
  const whole = Math.floor(n);
  const frac = +(n - whole).toFixed(4);
  for (const [val, sym] of Object.entries(FRACTIONS)) {
    if (Math.abs(frac - parseFloat(val)) < 0.02) {
      return whole > 0 ? `${whole}${sym}` : sym;
    }
  }
  return String(n);
}

function formatIngredient(ing) {
  const amt = formatAmount(ing.amount);
  return ing.unit ? `${amt} ${ing.unit} ${ing.name}` : `${amt} ${ing.name}`;
}

// ---- TOP-LEVEL RENDER ----
function render() {
  renderHeader();
  renderContent();
}

function renderHeader() {
  const header = document.getElementById('appHeader');
  header.innerHTML = '';

  if (appState.view === 'cook') {
    header.appendChild(buildCookHeader());
  } else {
    header.appendChild(buildBrowseHeader());
  }
}

function renderContent() {
  const content = document.getElementById('content');
  content.innerHTML = '';

  if (appState.view === 'cook') {
    content.appendChild(buildCookContent());
    updateActiveStep();
  } else {
    content.appendChild(buildBrowseContent());
  }
}

// ==================================================================
// BROWSE VIEW
// ==================================================================

function buildBrowseHeader() {
  const wrap = document.createElement('div');

  const eyebrowRow = document.createElement('div');
  eyebrowRow.className = 'eyebrow-row';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Kitchen Chemistry';
  eyebrowRow.appendChild(eyebrow);
  wrap.appendChild(eyebrowRow);

  // Search bar
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'search-bar';
  search.placeholder = 'Search recipes or ingredients…';
  search.value = appState.searchQuery;
  // Only re-render the content, not the header — rebuilding this input on
  // every keystroke would steal focus and reset the cursor position.
  search.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    renderContent();
  });
  wrap.appendChild(search);

  // View toggle
  const toggle = document.createElement('div');
  toggle.className = 'view-toggle';
  [['category', 'By Category'], ['technique', 'By Technique']].forEach(([mode, label]) => {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn' + (appState.browseMode === mode ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      appState.browseMode = mode;
      renderContent();
      // update active states on the toggle buttons without a full header rebuild
      toggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    toggle.appendChild(btn);
  });
  wrap.appendChild(toggle);

  return wrap;
}

function buildBrowseContent() {
  const wrap = document.createElement('div');

  if (savedProgress && recipes[savedProgress.recipeId]) {
    wrap.appendChild(buildResumeBanner());
  }

  const query = appState.searchQuery.trim().toLowerCase();
  const entries = Object.entries(recipes).filter(([id, recipe]) => {
    if (!query) return true;
    if (recipe.title.toLowerCase().includes(query)) return true;
    return recipe.ingredients.some(ing => ing.name.toLowerCase().includes(query));
  });

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'end-marker';
    empty.style.paddingTop = '30px';
    empty.textContent = query ? 'No recipes match your search' : 'No recipes yet';
    wrap.appendChild(empty);
    return wrap;
  }

  const groups = appState.browseMode === 'technique'
    ? groupByTechnique(entries)
    : groupByCategory(entries);

  groups.forEach(group => {
    const heading = document.createElement('p');
    heading.className = 'section-heading';
    heading.textContent = group.label;
    wrap.appendChild(heading);

    group.entries.forEach(([id, recipe]) => {
      wrap.appendChild(buildRecipeRow(id, recipe));
    });
  });

  return wrap;
}

function groupByCategory(entries) {
  const byCategory = {};
  entries.forEach(([id, recipe]) => {
    const cat = recipe.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push([id, recipe]);
  });

  const orderedKeys = Object.keys(byCategory).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return orderedKeys.map(cat => ({ label: cat, entries: byCategory[cat] }));
}

function groupByTechnique(entries) {
  const groups = [];
  Object.keys(techniques).forEach(techId => {
    const matching = entries.filter(([id, recipe]) =>
      recipe.steps.some(step => step.technique === techId)
    );
    if (matching.length > 0) {
      groups.push({ label: techniques[techId].name, entries: matching });
    }
  });
  return groups;
}

function buildResumeBanner() {
  const recipe = recipes[savedProgress.recipeId];
  const banner = document.createElement('button');
  banner.className = 'resume-banner';
  banner.innerHTML = `
    <span class="resume-label">Continue</span>
    <span class="resume-title">${recipe.title}</span>
    <span class="resume-meta">Step ${savedProgress.stepIndex + 1} of ${recipe.steps.length}</span>
  `;
  banner.addEventListener('click', () => openRecipe(savedProgress.recipeId, savedProgress.stepIndex));
  return banner;
}

function buildRecipeRow(id, recipe) {
  const row = document.createElement('div');
  row.className = 'recipe-row';

  const main = document.createElement('button');
  main.className = 'recipe-row-main';
  main.innerHTML = `
    <span class="recipe-row-category">${recipe.category || ''}</span>
    <span class="recipe-row-title">${recipe.title}</span>
  `;
  main.addEventListener('click', () => openRecipe(id, 0));
  row.appendChild(main);

  const isOpen = !!ingredientDropdownOpen[id];
  const toggle = document.createElement('button');
  toggle.className = 'ingredients-toggle';
  toggle.innerHTML = `<span>${isOpen ? 'Hide ingredients' : `Ingredients (${recipe.ingredients.length})`}</span><span class="chevron">${isOpen ? '▲' : '▼'}</span>`;
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    ingredientDropdownOpen[id] = !isOpen;
    renderContent();
  });
  row.appendChild(toggle);

  if (isOpen) {
    const panel = document.createElement('div');
    panel.className = 'ingredients-panel';
    recipe.ingredients.forEach(ing => {
      const line = document.createElement('p');
      line.className = 'ingredient-line';
      line.textContent = formatIngredient(ing);
      panel.appendChild(line);
    });
    row.appendChild(panel);
  }

  return row;
}

function openRecipe(id, stepIndexToResume) {
  currentRecipeId = id;
  panelOpenState = recipes[id].steps.map(() => false);
  appState.view = 'cook';
  lastSavedStepIndex = -1;
  render();

  if (stepIndexToResume > 0) {
    requestAnimationFrame(() => {
      const card = document.querySelector(`.step-card[data-index="${stepIndexToResume}"]`);
      if (card) card.scrollIntoView({ block: 'start' });
    });
  }
}

// ==================================================================
// COOK VIEW (existing step-feed behavior)
// ==================================================================

function buildCookHeader() {
  const wrap = document.createElement('div');

  const eyebrowRow = document.createElement('div');
  eyebrowRow.className = 'eyebrow-row';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.innerHTML = '&larr; Browse';
  backBtn.addEventListener('click', () => {
    appState.view = 'browse';
    render();
  });
  eyebrowRow.appendChild(backBtn);

  const progress = document.createElement('span');
  progress.className = 'step-progress';
  progress.id = 'stepProgress';
  eyebrowRow.appendChild(progress);

  wrap.appendChild(eyebrowRow);

  const title = document.createElement('h1');
  title.className = 'recipe-title';
  title.textContent = currentRecipe().title;
  wrap.appendChild(title);

  return wrap;
}

function buildCookContent() {
  const wrap = document.createElement('div');
  const recipe = currentRecipe();

  recipe.steps.forEach((step, i) => {
    const card = document.createElement('div');
    card.className = 'step-card';
    card.dataset.index = i;

    const num = document.createElement('div');
    num.className = 'step-num';
    num.innerHTML = `<span class="num-dot"></span> Step ${i + 1} of ${recipe.steps.length}`;
    card.appendChild(num);

    const instr = document.createElement('p');
    instr.className = 'step-instruction';
    instr.textContent = step.instruction;
    card.appendChild(instr);

    if (step.ingredients.length) {
      const row = document.createElement('div');
      row.className = 'ingredient-row';
      step.ingredients.forEach(ing => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = formatIngredient(ing);
        row.appendChild(chip);
      });
      card.appendChild(row);
    }

    if (step.technique) {
      const tech = techniques[step.technique];
      const isOpen = !!panelOpenState[i];

      const trigger = document.createElement('button');
      trigger.className = 'why-trigger';
      trigger.innerHTML = `<span class="flame">&#128293;</span><span>${isOpen ? 'Hide the science' : 'Why this step?'}</span>`;
      trigger.addEventListener('click', () => {
        panelOpenState[i] = !panelOpenState[i];
        renderContent();
      });
      card.appendChild(trigger);

      const panel = document.createElement('div');
      panel.className = 'why-panel' + (isOpen ? ' open' : '');

      const techName = document.createElement('p');
      techName.className = 'technique-name';
      techName.textContent = tech.name;
      panel.appendChild(techName);

      const gauge = document.createElement('div');
      gauge.className = 'depth-gauge';
      const sizes = [14, 19, 24];
      const labels = ['Quick', 'Standard', 'Deep'];
      labels.forEach((label, lvl) => {
        const btn = document.createElement('button');
        btn.className = 'flame-btn' + (lvl === depthLevel ? ' active' : '');
        btn.dataset.level = lvl;
        btn.innerHTML = `<span class="icon" style="font-size:${sizes[lvl]}px">&#128293;</span><span>${label}</span>`;
        btn.addEventListener('click', () => {
          depthLevel = lvl;
          saveDepthPreference(lvl);
          renderContent();
        });
        gauge.appendChild(btn);
      });
      panel.appendChild(gauge);

      const explanation = document.createElement('p');
      explanation.className = 'explanation-text';
      const depthLabels = ['Quick Fact', 'Standard', 'Deep Dive'];
      explanation.innerHTML = `<span class="depth-label">${depthLabels[depthLevel]}</span>${tech.explanations[depthLevel]}`;
      panel.appendChild(explanation);

      card.appendChild(panel);
    }

    wrap.appendChild(card);
  });

  const endMarker = document.createElement('p');
  endMarker.className = 'end-marker';
  endMarker.textContent = 'End of recipe';
  wrap.appendChild(endMarker);

  return wrap;
}

// ---- SCROLL-BASED ACTIVE STEP TRACKING ----
function updateActiveStep() {
  const content = document.getElementById('content');
  const cards = content.querySelectorAll('.step-card');
  if (!cards.length) return;

  const contentRect = content.getBoundingClientRect();
  let activeIndex = 0;

  // If the container is scrolled to (or very near) its bottom, the last
  // card can never physically reach the "near top" target offset used
  // below — there's no scroll room left to push it there. Detect that
  // case directly instead of relying on position math.
  const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 4;

  if (atBottom) {
    activeIndex = cards.length - 1;
  } else {
    let minDist = Infinity;
    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      const dist = Math.abs(rect.top - contentRect.top - 12);
      if (dist < minDist) { minDist = dist; activeIndex = i; }
    });
  }

  cards.forEach(card => card.classList.remove('in-view'));
  cards[activeIndex].classList.add('in-view');

  const progressEl = document.getElementById('stepProgress');
  if (progressEl) progressEl.textContent = `Step ${activeIndex + 1} of ${cards.length}`;

  if (activeIndex !== lastSavedStepIndex) {
    lastSavedStepIndex = activeIndex;
    savedProgress = { recipeId: currentRecipeId, stepIndex: activeIndex };
    saveProgress(currentRecipeId, activeIndex);
  }
}

let scrollTicking = false;
document.addEventListener('DOMContentLoaded', () => {
  const content = document.getElementById('content');
  content.addEventListener('scroll', () => {
    if (appState.view !== 'cook') return;
    if (!scrollTicking) {
      requestAnimationFrame(() => { updateActiveStep(); scrollTicking = false; });
      scrollTicking = true;
    }
  });
});

// ---- SERVICE WORKER (for PWA installability) ----
// Only registers meaningfully when served from a real http(s) origin.
// Opened as a local file or inside a chat preview, this will typically
// no-op silently rather than throw — that's expected in this environment.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Registration failure here is expected outside a real hosted origin.
    });
  });
}

// ---- INIT ----
async function init() {
  try {
    await loadData();
  } catch (err) {
    document.getElementById('content').innerHTML =
      '<p class="step-instruction">Could not load recipe data. If you\'re opening this file directly, use VS Code\'s Live Server instead — fetching local JSON requires being served over http, not file://.</p>';
    console.error('Failed to load data:', err);
    return;
  }
  await loadDepthPreference();
  savedProgress = await loadProgress();
  render();
}
init();
