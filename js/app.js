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
const CATEGORY_ORDER = ['Breakfast', 'Mains', 'Sides', 'Sauces & Dressings', 'Desserts'];

// Theme metadata — swatches are just for the settings picker preview, the
// actual colors live in css/styles.css under [data-theme="..."]. Adding a
// theme means: add its variable block in CSS, then add one entry here.
const THEMES = {
  classic: { name: 'Classic', description: 'Cast iron pan at night — dark, moody, ember accents.', swatches: ['#121212', '#ff7a45', '#6fa8b5'] },
  warm: { name: 'Warm', description: 'Farmers market at noon — light, vibrant, coral and gold.', swatches: ['#fcf3e7', '#b5304e', '#936014'] }
};

// ---- STATE ----
let appState = {
  view: 'browse',        // 'browse' | 'cook' | 'glossary' | 'checker' | 'settings'
  browseMode: 'category', // 'category' | 'technique'
  searchQuery: ''
};
let currentRecipeId = null;
let currentTheme = 'classic';
let depthLevel = 1;          // default: Standard, global across all steps
let panelOpenState = [];     // per-step booleans in cook view, reset per recipe
let ingredientDropdownOpen = {}; // recipeId -> bool, for browse-screen dropdowns
let glossaryOpenState = {};      // techniqueId -> bool, for the glossary screen

// Recipe Checker state
let checkerRows = [{ id: 1, techniqueId: '', values: {}, result: null }];
let checkerNextId = 2;
let savedProgress = null;    // { recipeId, stepIndex } | null — for resume banner
let lastSavedStepIndex = -1; // avoids writing to storage on every scroll tick

function applyTheme(themeId) {
  currentTheme = THEMES[themeId] ? themeId : 'classic';
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// Fixed pixel distance from the top of the visible step-feed area at which
// a step counts as "current." Deliberately a small, near-the-top number —
// see updateActiveStep() and the scroll-spacer logic in buildCookContent()
// for why this only works correctly paired with a dynamically-sized spacer
// at the end of the list.
const ACTIVE_LINE_OFFSET = 90;

function currentRecipe() { return recipes[currentRecipeId]; }

// ---- FORMATTING HELPERS ----
// Common cooking fractions as [numerator, denominator] pairs, rendered with
// the numerator/denominator slightly smaller than surrounding text (via
// native <sup>/<sub>) and a real slash between them — the standard
// typographic convention (e.g. "⅓ cup"), distinct enough from whole
// numbers to read clearly without being cramped or illegible.
const FRACTION_PARTS = { 0.25: [1, 4], 0.5: [1, 2], 0.75: [3, 4], 0.3333: [1, 3], 0.6667: [2, 3], 0.125: [1, 8], 0.375: [3, 8], 0.625: [5, 8], 0.875: [7, 8] };

function formatAmount(n) {
  if (n === null || n === undefined) return '';
  const whole = Math.floor(n);
  const frac = +(n - whole).toFixed(4);

  for (const [val, [num, denom]] of Object.entries(FRACTION_PARTS)) {
    if (Math.abs(frac - parseFloat(val)) < 0.02) {
      const fracHTML = `<span class="fraction"><sup>${num}</sup>&frasl;<sub>${denom}</sub></span>`;
      return whole > 0 ? `${whole} ${fracHTML}` : fracHTML;
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
  } else if (appState.view === 'glossary') {
    header.appendChild(buildGlossaryHeader());
  } else if (appState.view === 'checker') {
    header.appendChild(buildCheckerHeader());
  } else if (appState.view === 'settings') {
    header.appendChild(buildSettingsHeader());
  } else {
    header.appendChild(buildBrowseHeader());
  }
}

function renderContent() {
  const content = document.getElementById('content');
  content.innerHTML = '';
  // Clearing innerHTML does NOT reset scrollTop on its own — the element
  // keeps whatever scroll offset it had, and since Browse and Cook share
  // this same container, opening a new recipe (or a different one) was
  // inheriting leftover scroll position from wherever you'd been before.
  // Reset here by default; the two in-place toggles below (why-panel,
  // depth level) explicitly save and restore scroll around their own
  // renderContent() calls specifically to opt back OUT of this reset,
  // since those should stay right where you were reading.
  content.scrollTop = 0;

  if (appState.view === 'cook') {
    content.appendChild(buildCookContent());
    sizeScrollSpacer(); // must run after the content above is in the DOM — needs real measurements
    updateActiveStep();
  } else if (appState.view === 'glossary') {
    content.appendChild(buildGlossaryContent());
  } else if (appState.view === 'checker') {
    content.appendChild(buildCheckerContent());
  } else if (appState.view === 'settings') {
    content.appendChild(buildSettingsContent());
  } else {
    content.appendChild(buildBrowseContent());
  }
}

// For in-place interactions that shouldn't jump the user back to the top —
// toggling a why-panel or changing depth level mid-recipe should feel like
// the content around you updated, not like you got sent somewhere else.
function renderContentPreservingScroll() {
  const content = document.getElementById('content');
  const savedScroll = content.scrollTop;
  renderContent();
  content.scrollTop = savedScroll;
  updateActiveStep(); // re-sync the header/highlight against the restored position, not the momentary reset-to-0 state
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

  // Utility links — pulled out of the eyebrow row into their own line so
  // that row doesn't get crowded as more of these get added over time.
  const utilityLinks = document.createElement('div');
  utilityLinks.className = 'utility-links';

  const glossaryBtn = document.createElement('button');
  glossaryBtn.className = 'back-btn';
  glossaryBtn.innerHTML = '&#128214; Glossary';
  glossaryBtn.addEventListener('click', () => {
    appState.view = 'glossary';
    render();
  });
  utilityLinks.appendChild(glossaryBtn);

  const checkerBtn = document.createElement('button');
  checkerBtn.className = 'back-btn';
  checkerBtn.innerHTML = '&#128300; Check a Recipe';
  checkerBtn.addEventListener('click', () => {
    appState.view = 'checker';
    render();
  });
  utilityLinks.appendChild(checkerBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'back-btn';
  settingsBtn.innerHTML = '&#9881; Settings';
  settingsBtn.addEventListener('click', () => {
    appState.view = 'settings';
    render();
  });
  utilityLinks.appendChild(settingsBtn);

  wrap.appendChild(utilityLinks);

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
  const categoryLabel = appState.browseMode === 'technique' ? recipe.category || '' : '';
  main.innerHTML = `
    ${categoryLabel ? `<span class="recipe-row-category">${categoryLabel}</span>` : ''}
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
    renderContentPreservingScroll();
  });
  row.appendChild(toggle);

  if (isOpen) {
    const panel = document.createElement('div');
    panel.className = 'ingredients-panel';
    recipe.ingredients.forEach(ing => {
      const line = document.createElement('p');
      line.className = 'ingredient-line';
      line.innerHTML = formatIngredient(ing);
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
// GLOSSARY VIEW — study techniques on their own, independent of any
// particular recipe. Reuses the same Quick/Standard/Deep depth-gauge
// component from cooking mode, so there's nothing new to learn there.
// ==================================================================

function buildGlossaryHeader() {
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
  wrap.appendChild(eyebrowRow);

  const title = document.createElement('h1');
  title.className = 'recipe-title';
  title.textContent = 'Technique Glossary';
  wrap.appendChild(title);

  return wrap;
}

function buildGlossaryContent() {
  const wrap = document.createElement('div');

  Object.entries(techniques).forEach(([techId, tech]) => {
    wrap.appendChild(buildGlossaryEntry(techId, tech));
  });

  return wrap;
}

function buildGlossaryEntry(techId, tech) {
  const row = document.createElement('div');
  row.className = 'recipe-row'; // reusing the same row/divider styling as recipe list items

  const isOpen = !!glossaryOpenState[techId];

  const trigger = document.createElement('button');
  trigger.className = 'recipe-row-main';
  trigger.innerHTML = `<span class="recipe-row-title">${tech.name}</span>`;
  trigger.addEventListener('click', () => {
    glossaryOpenState[techId] = !isOpen;
    renderContentPreservingScroll();
  });
  row.appendChild(trigger);

  if (isOpen) {
    const panel = document.createElement('div');
    panel.className = 'why-panel open';
    panel.style.marginTop = '8px';

    const gauge = document.createElement('div');
    gauge.className = 'depth-gauge';
    const sizes = [14, 19, 24];
    const labels = ['Quick', 'Standard', 'Deep'];
    labels.forEach((label, lvl) => {
      const btn = document.createElement('button');
      btn.className = 'flame-btn' + (lvl === depthLevel ? ' active' : '');
      btn.innerHTML = `<span class="icon" style="font-size:${sizes[lvl]}px">&#128293;</span><span>${label}</span>`;
      btn.addEventListener('click', () => {
        depthLevel = lvl;
        saveDepthPreference(lvl);
        renderContentPreservingScroll();
      });
      gauge.appendChild(btn);
    });
    panel.appendChild(gauge);

    const explanation = document.createElement('p');
    explanation.className = 'explanation-text';
    const depthLabels = ['Quick Fact', 'Standard', 'Deep Dive'];
    explanation.innerHTML = `<span class="depth-label">${depthLabels[depthLevel]}</span>${tech.explanations[depthLevel]}`;
    panel.appendChild(explanation);

    // "Used in" cross-links — same underlying match used by the By
    // Technique browse view, just scoped to this one technique.
    const usedIn = Object.entries(recipes).filter(([, r]) =>
      r.steps.some(step => step.technique === techId)
    );
    if (usedIn.length > 0) {
      const usedInLabel = document.createElement('p');
      usedInLabel.className = 'depth-label';
      usedInLabel.style.marginTop = '14px';
      usedInLabel.textContent = 'Used In';
      panel.appendChild(usedInLabel);

      const linkRow = document.createElement('div');
      linkRow.className = 'ingredient-row';
      usedIn.forEach(([rid, r]) => {
        const link = document.createElement('button');
        link.className = 'chip';
        link.style.cursor = 'pointer';
        link.style.color = 'var(--ember)';
        link.style.borderColor = 'var(--ember-dim)';
        link.textContent = r.title;
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          openRecipe(rid, 0);
        });
        linkRow.appendChild(link);
      });
      panel.appendChild(linkRow);
    }

    row.appendChild(panel);
  }

  return row;
}

// ==================================================================
// RECIPE CHECKER — a manual, rule-based stand-in for the eventual
// AI-parsed recipe import. Every technique below with a `check` field in
// techniques.json has a real, numeric, testable rule; techniques without
// one (most of them) are process-based, not quantity-based, so there's
// genuinely nothing to check — that list isn't shown as an option here.
// ==================================================================

function checkableTechniqueIds() {
  return Object.keys(techniques).filter(id => techniques[id].check);
}

function buildCheckerHeader() {
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
  wrap.appendChild(eyebrowRow);

  const title = document.createElement('h1');
  title.className = 'recipe-title';
  title.textContent = 'Recipe Checker';
  wrap.appendChild(title);

  return wrap;
}

function buildCheckerContent() {
  const wrap = document.createElement('div');

  const intro = document.createElement('p');
  intro.className = 'explanation-text';
  intro.style.marginBottom = '18px';
  intro.textContent = 'Enter amounts from a recipe you\'re unsure about and check them against typical ranges for that technique. This checks quantities in isolation — it has no idea about the rest of the recipe, so use it as a second opinion, not a verdict.';
  wrap.appendChild(intro);

  checkerRows.forEach(row => wrap.appendChild(buildCheckerRow(row)));

  const addBtn = document.createElement('button');
  addBtn.className = 'checker-add-btn';
  addBtn.textContent = '+ Add Another Check';
  addBtn.addEventListener('click', () => {
    checkerRows.push({ id: checkerNextId++, techniqueId: '', values: {}, result: null });
    renderContentPreservingScroll();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

// Each row is fully self-contained: its own technique picker, its own
// input fields, its own "Check This" button, and — once checked — its own
// result shown directly beneath, all inside the same card. Rows never
// share state or rendering with each other.
function buildCheckerRow(row) {
  const container = document.createElement('div');
  container.className = 'checker-row';

  const headerLine = document.createElement('div');
  headerLine.className = 'checker-row-header';

  const select = document.createElement('select');
  select.className = 'checker-select';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a technique to check…';
  select.appendChild(placeholder);
  checkableTechniqueIds().forEach(techId => {
    const opt = document.createElement('option');
    opt.value = techId;
    opt.textContent = techniques[techId].name;
    if (row.techniqueId === techId) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', (e) => {
    // Switching technique invalidates whatever was typed for the old one.
    row.techniqueId = e.target.value;
    row.values = {};
    row.result = null;
    renderContentPreservingScroll();
  });
  headerLine.appendChild(select);

  if (checkerRows.length > 1) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'checker-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => {
      checkerRows = checkerRows.filter(r => r.id !== row.id);
      renderContentPreservingScroll();
    });
    headerLine.appendChild(removeBtn);
  }

  container.appendChild(headerLine);

  if (row.techniqueId) {
    const check = techniques[row.techniqueId].check;

    if (check.type === 'absolute') {
      // When there's no unit dropdown (e.g. resting's time in minutes),
      // show the unit in the label instead, since nothing else conveys it.
      const amountLabel = check.unit_options ? check.label : `${check.label} (${check.unit})`;
      container.appendChild(buildCheckerField(row, 'amount', amountLabel, check.unit_options));
    } else if (check.type === 'ratio') {
      const fieldRow = document.createElement('div');
      fieldRow.className = 'checker-field-row';
      fieldRow.appendChild(buildCheckerField(row, 'a', check.label_a, check.unit_options));
      fieldRow.appendChild(buildCheckerField(row, 'b', check.label_b, check.unit_options));
      container.appendChild(fieldRow);
    } else if (check.type === 'leavening') {
      const subtypeSelect = document.createElement('select');
      subtypeSelect.className = 'checker-select';
      Object.entries(check.options).forEach(([key, opt]) => {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = opt.label;
        if ((row.values.subtype || 'baking_powder') === key) o.selected = true;
        subtypeSelect.appendChild(o);
      });
      subtypeSelect.addEventListener('change', (e) => { row.values.subtype = e.target.value; });
      container.appendChild(subtypeSelect);

      const fieldRow = document.createElement('div');
      fieldRow.className = 'checker-field-row';
      fieldRow.appendChild(buildCheckerField(row, 'leavener', 'Leavener', check.leavener_unit_options));
      fieldRow.appendChild(buildCheckerField(row, 'flour', 'Flour (cups)', null));
      container.appendChild(fieldRow);
    }

    const checkBtn = document.createElement('button');
    checkBtn.className = 'checker-check-btn';
    checkBtn.textContent = 'Check This';
    checkBtn.addEventListener('click', () => {
      row.result = runSingleCheck(row);
      renderContentPreservingScroll();
    });
    container.appendChild(checkBtn);

    if (row.result) {
      container.appendChild(buildCheckerResultCard(row.result));
    }
  }

  return container;
}

// valueKey is which field on row.values this input reads from/writes to
// (e.g. 'amount', 'a', 'b', 'leavener', 'flour') — NOT a DOM id. Values
// live in JS state from the moment they're typed, via the input event
// below, so a re-render anywhere (adding a row, switching a technique on
// a DIFFERENT row) can always restore exactly what was here, instead of
// silently discarding it.
// ---- FRACTION PARSING + UNIT CONVERSION (Recipe Checker) ----
// Accepts "1/4", "1 1/4" (mixed number), "0.25", or "2" — whatever
// matches how the recipe in front of the user is actually written, rather
// than making them convert to decimal first.
function parseFractionInput(str) {
  if (str === undefined || str === null) return NaN;
  const s = String(str).trim();
  if (s === '') return NaN;

  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const denom = parseInt(mixed[3], 10);
    if (denom === 0) return NaN;
    return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / denom;
  }

  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const denom = parseInt(frac[2], 10);
    if (denom === 0) return NaN;
    return parseInt(frac[1], 10) / denom;
  }

  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

// Simple volume unit conversion — everything expressed in teaspoon-
// equivalents first, then converted to whatever unit the check actually
// needs. This means a user can enter salt in Tbsp and water in cups on
// the SAME ratio check and it'll still compute correctly, since both get
// normalized before the math happens.
const VOLUME_TSP = { tsp: 1, Tbsp: 3, cup: 48 };
function convertVolume(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return amount;
  return (amount * VOLUME_TSP[fromUnit]) / VOLUME_TSP[toUnit];
}

// unitOptions, when provided, is an array like ['Tbsp', 'tsp', 'cup'] —
// the FIRST entry is the default/native unit for this check. When present,
// a small unit dropdown appears next to the input, and the selected unit
// is stored in row.values[valueKey + '_unit']; runSingleCheck() converts
// back to the check's native unit before doing any comparison math.
function buildCheckerField(row, valueKey, labelText, unitOptions) {
  const field = document.createElement('div');
  field.className = 'checker-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);

  const inputRow = document.createElement('div');
  inputRow.className = 'checker-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'e.g. 1/4';
  input.className = 'checker-input';
  input.value = row.values[valueKey] || '';
  input.addEventListener('input', (e) => { row.values[valueKey] = e.target.value; });
  inputRow.appendChild(input);

  if (unitOptions) {
    const unitKey = valueKey + '_unit';
    const unitSelect = document.createElement('select');
    unitSelect.className = 'checker-unit-select';
    unitOptions.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if ((row.values[unitKey] || unitOptions[0]) === u) opt.selected = true;
      unitSelect.appendChild(opt);
    });
    unitSelect.addEventListener('change', (e) => { row.values[unitKey] = e.target.value; });
    inputRow.appendChild(unitSelect);
  }

  field.appendChild(inputRow);
  return field;
}

// Rounds to 3 decimal places and drops trailing zeros (so 1/3 shows as
// "0.333", not "0.3333333333333333", but 0.25 still shows as "0.25", not
// "0.250"). parseFloat after toFixed is what strips the trailing zeros.
function roundNum(n) {
  return parseFloat(n.toFixed(3));
}

function runSingleCheck(row) {
  const tech = techniques[row.techniqueId];
  const check = tech.check;
  const v = row.values;

  if (check.type === 'absolute') {
    const raw = parseFractionInput(v.amount);
    if (isNaN(raw)) return { ok: false, techName: tech.name, rows: [], detail: 'Enter a value first.' };
    const fromUnit = v.amount_unit || check.unit;
    const amount = convertVolume(raw, fromUnit, check.unit);
    const ok = amount >= check.min && amount <= check.max;
    const value = fromUnit === check.unit
      ? `${roundNum(raw)} ${check.unit}`
      : `${roundNum(raw)} ${fromUnit}  (= ${roundNum(amount)} ${check.unit})`;
    return {
      techName: tech.name,
      ok,
      rows: [{ label: check.label, value }],
      detail: ok
        ? `Within the typical ${check.min}-${check.max} ${check.unit} range, ${check.context}.`
        : `Outside the typical ${check.min}-${check.max} ${check.unit} range, ${check.context}. ${amount > check.max ? 'This is more than usual — ' + techniqueOverExplanation(row.techniqueId) : 'This is less than usual — ' + techniqueUnderExplanation(row.techniqueId)}`
    };
  }

  if (check.type === 'ratio') {
    const rawA = parseFractionInput(v.a);
    const rawB = parseFractionInput(v.b);
    if (isNaN(rawA) || isNaN(rawB) || rawB === 0) return { ok: false, techName: tech.name, rows: [], detail: 'Enter both values first.' };
    // Both sides convert independently to the check's native unit before
    // dividing — this is what lets someone enter salt in Tbsp and water
    // in cups on the same check and still get a correct ratio.
    const unitA = v.a_unit || check.unit;
    const unitB = v.b_unit || check.unit;
    const a = convertVolume(rawA, unitA, check.unit);
    const b = convertVolume(rawB, unitB, check.unit);
    const ratio = a / b;
    const ok = ratio >= check.min_ratio && ratio <= check.max_ratio;
    const valueA = unitA === check.unit ? `${roundNum(rawA)} ${unitA}` : `${roundNum(rawA)} ${unitA}  (= ${roundNum(a)} ${check.unit})`;
    const valueB = unitB === check.unit ? `${roundNum(rawB)} ${unitB}` : `${roundNum(rawB)} ${unitB}  (= ${roundNum(b)} ${check.unit})`;
    return {
      techName: tech.name,
      ok,
      rows: [
        { label: check.label_a, value: valueA },
        { label: check.label_b, value: valueB },
        { label: 'Ratio', value: `${roundNum(ratio)} : 1` }
      ],
      detail: ok
        ? `Within the typical range — ${check.context}.`
        : `Outside the typical range — ${check.context}. This ratio is ${ratio > check.max_ratio ? 'higher' : 'lower'} than usual.`
    };
  }

  if (check.type === 'leavening') {
    const subtype = v.subtype || 'baking_powder';
    const rawLeavener = parseFractionInput(v.leavener);
    const flour = parseFractionInput(v.flour);
    if (isNaN(rawLeavener) || isNaN(flour) || flour === 0) return { ok: false, techName: tech.name, rows: [], detail: 'Enter both values first.' };
    const leavenerUnit = v.leavener_unit || 'tsp';
    const leavener = convertVolume(rawLeavener, leavenerUnit, 'tsp'); // the check's ratio is always expressed per tsp
    const opt = check.options[subtype];
    const perCup = leavener / flour;
    const ok = perCup >= opt.min && perCup <= opt.max;
    const leavenerValue = leavenerUnit === 'tsp' ? `${roundNum(rawLeavener)} tsp` : `${roundNum(rawLeavener)} ${leavenerUnit}  (= ${roundNum(leavener)} tsp)`;
    return {
      techName: `${tech.name} (${opt.label})`,
      ok,
      rows: [
        { label: 'Leavener', value: leavenerValue },
        { label: 'Flour', value: `${roundNum(flour)} cup` },
        { label: 'Per cup of flour', value: `${roundNum(perCup)} tsp` }
      ],
      detail: ok
        ? `Within the typical ${opt.min}-${opt.max} tsp/cup range — ${check.context}.`
        : `Outside the typical ${opt.min}-${opt.max} tsp/cup range — ${check.context}. ${perCup > opt.max ? 'This much can leave a bitter or metallic aftertaste.' : 'This little may not provide enough lift.'}`
    };
  }
}

// Short, technique-specific plain-language reasons for going over/under —
// keeps the result explanation from being generic across every technique.
function techniqueOverExplanation(techId) {
  const map = {
    searing: "excess oil can insulate the meat and cause it to steam instead of brown.",
    resting: "resting longer isn't harmful, just unnecessary — the meat may just be cooling off."
  };
  return map[techId] || "this is worth double-checking against the recipe's context.";
}
function techniqueUnderExplanation(techId) {
  const map = {
    searing: "too little oil risks sticking and uneven browning.",
    resting: "cutting in too early lets moisture run out onto the board instead of redistributing."
  };
  return map[techId] || "this is worth double-checking against the recipe's context.";
}

function buildCheckerResultCard(result) {
  const card = document.createElement('div');
  card.className = 'checker-result-card' + (result.ok ? '' : ' flagged');

  const verdict = document.createElement('p');
  verdict.className = 'checker-verdict ' + (result.ok ? 'good' : 'flagged');
  verdict.textContent = (result.ok ? '✓ Looks Right — ' : '⚠ Worth a Second Look — ') + result.techName;
  card.appendChild(verdict);

  if (result.rows.length > 0) {
    const dataBlock = document.createElement('div');
    dataBlock.className = 'checker-data-block';
    result.rows.forEach(({ label, value }) => {
      const line = document.createElement('div');
      line.className = 'checker-data-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'checker-data-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'checker-data-value';
      valueEl.textContent = value;
      line.appendChild(labelEl);
      line.appendChild(valueEl);
      dataBlock.appendChild(line);
    });
    card.appendChild(dataBlock);
  }

  if (result.detail) {
    const detail = document.createElement('p');
    detail.className = 'explanation-text checker-detail';
    detail.style.fontSize = '13.5px';
    detail.textContent = result.detail;
    card.appendChild(detail);
  }

  return card;
}

// ==================================================================
// SETTINGS VIEW
// ==================================================================

function buildSettingsHeader() {
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
  wrap.appendChild(eyebrowRow);

  const title = document.createElement('h1');
  title.className = 'recipe-title';
  title.textContent = 'Settings';
  wrap.appendChild(title);

  return wrap;
}

function buildSettingsContent() {
  const wrap = document.createElement('div');

  // ---- Explanation depth ----
  const depthHeading = document.createElement('p');
  depthHeading.className = 'section-heading';
  depthHeading.textContent = 'Default Explanation Depth';
  depthHeading.style.marginTop = '0';
  wrap.appendChild(depthHeading);

  const depthDesc = document.createElement('p');
  depthDesc.className = 'explanation-text';
  depthDesc.style.marginBottom = '10px';
  depthDesc.textContent = 'How much science shows by default when you open a "why" panel anywhere in the app.';
  wrap.appendChild(depthDesc);

  const gauge = document.createElement('div');
  gauge.className = 'depth-gauge';
  const sizes = [14, 19, 24];
  const labels = ['Quick', 'Standard', 'Deep'];
  labels.forEach((label, lvl) => {
    const btn = document.createElement('button');
    btn.className = 'flame-btn' + (lvl === depthLevel ? ' active' : '');
    btn.innerHTML = `<span class="icon" style="font-size:${sizes[lvl]}px">&#128293;</span><span>${label}</span>`;
    btn.addEventListener('click', () => {
      depthLevel = lvl;
      saveDepthPreference(lvl);
      renderContent();
    });
    gauge.appendChild(btn);
  });
  wrap.appendChild(gauge);

  // ---- Theme ----
  const themeHeading = document.createElement('p');
  themeHeading.className = 'section-heading';
  themeHeading.textContent = 'Theme';
  wrap.appendChild(themeHeading);

  Object.entries(THEMES).forEach(([themeId, theme]) => {
    wrap.appendChild(buildThemeOption(themeId, theme));
  });

  // ---- Data ----
  const dataHeading = document.createElement('p');
  dataHeading.className = 'section-heading';
  dataHeading.textContent = 'Data';
  wrap.appendChild(dataHeading);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'checker-add-btn'; // reusing the outlined-button style
  clearBtn.textContent = savedProgress ? 'Clear Saved Progress' : 'No Saved Progress to Clear';
  clearBtn.disabled = !savedProgress;
  if (!savedProgress) clearBtn.style.opacity = '0.5';
  clearBtn.addEventListener('click', async () => {
    await clearProgress();
    savedProgress = null;
    clearBtn.textContent = 'No Saved Progress to Clear';
    clearBtn.disabled = true;
    clearBtn.style.opacity = '0.5';
  });
  wrap.appendChild(clearBtn);

  return wrap;
}

function buildThemeOption(themeId, theme) {
  const isActive = currentTheme === themeId;

  const option = document.createElement('button');
  option.className = 'theme-option' + (isActive ? ' active' : '');
  option.addEventListener('click', () => {
    if (isActive) return;
    applyTheme(themeId);
    saveThemePreference(themeId);
    renderContent(); // re-render so the "active" checkmark/border updates
  });

  const swatchRow = document.createElement('div');
  swatchRow.className = 'theme-swatch-row';
  theme.swatches.forEach(color => {
    const dot = document.createElement('span');
    dot.className = 'theme-swatch';
    dot.style.background = color;
    swatchRow.appendChild(dot);
  });
  option.appendChild(swatchRow);

  const textCol = document.createElement('div');
  textCol.className = 'theme-option-text';
  const name = document.createElement('p');
  name.className = 'theme-option-name';
  name.textContent = theme.name;
  textCol.appendChild(name);
  const desc = document.createElement('p');
  desc.className = 'theme-option-desc';
  desc.textContent = theme.description;
  textCol.appendChild(desc);
  option.appendChild(textCol);

  if (isActive) {
    const check = document.createElement('span');
    check.className = 'theme-option-check';
    check.innerHTML = '&#10003;';
    option.appendChild(check);
  }

  return option;
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
        chip.innerHTML = formatIngredient(ing);
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
        renderContentPreservingScroll();
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
          renderContentPreservingScroll();
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

  // Invisible spacer, sized after this content is actually in the DOM (see
  // sizeScrollSpacer()) — gives the last step enough scroll distance to
  // reach ACTIVE_LINE_OFFSET even if it's a short step with little content
  // below it. Without this, a short final step can never be detected as
  // "current" through normal scrolling, no matter where the line is set.
  const spacer = document.createElement('div');
  spacer.id = 'scrollSpacer';
  wrap.appendChild(spacer);

  return wrap;
}

function sizeScrollSpacer() {
  const content = document.getElementById('content');
  const cards = content.querySelectorAll('.step-card');
  const spacer = document.getElementById('scrollSpacer');
  if (!cards.length || !spacer) return;

  const lastCard = cards[cards.length - 1];
  const needed = Math.max(0, content.clientHeight - lastCard.offsetHeight - ACTIVE_LINE_OFFSET);
  spacer.style.height = needed + 'px';
}

// ---- SCROLL-BASED ACTIVE STEP TRACKING ----
//
// A step counts as "current" once its top has scrolled up to within
// ACTIVE_LINE_OFFSET px of the top of the screen — a small, natural-feeling
// distance, not a large fraction of the viewport. This only works
// correctly because buildCookContent()'s scroll-spacer guarantees every
// step, including a short last one, has enough scroll room to actually
// reach that line. (An earlier version tried compensating for insufficient
// room by moving the line itself much further down the screen — that
// "fixed" the skip but made steps highlight far too early. Fixing the
// actual lack of scroll room, instead of moving the line, is the right fix.)
function updateActiveStep() {
  const content = document.getElementById('content');
  const cards = content.querySelectorAll('.step-card');
  if (!cards.length) return;

  const contentRect = content.getBoundingClientRect();
  const activeLine = contentRect.top + ACTIVE_LINE_OFFSET;

  let activeIndex = 0;
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (rect.top <= activeLine) {
      activeIndex = i;
    } else {
      break; // cards are in document order — once one hasn't crossed yet, none after it have either
    }
  }

  // Safety net only — with the spacer in place this shouldn't be the
  // deciding factor, but it costs nothing to keep as a fallback for
  // sub-pixel rounding at the very bottom of the scroll range.
  const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 2;
  if (atBottom) activeIndex = cards.length - 1;

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
// Deliberately skipped on localhost / Live Server. A service worker caches
// the app shell and intercepts future requests to serve that cache instead
// of the network — great for offline use once the app is stable, actively
// harmful while we're editing files constantly, since a normal refresh
// won't show new changes; the browser just gets served yesterday's cached
// version. Only registers on a real deployed origin (e.g. GitHub Pages).
const isLocalDev = ['localhost', '127.0.0.1', ''].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocalDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Registration failure here is expected outside a real hosted origin.
    });
  });
}

// ---- INIT ----
async function init() {
  // Apply the theme first, before any data loading — avoids a flash of the
  // wrong theme on load, since this only touches a DOM attribute and CSS,
  // not the fetched recipe/technique data.
  const savedTheme = await loadThemePreference();
  applyTheme(savedTheme);

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