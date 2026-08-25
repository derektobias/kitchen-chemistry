// ---- DATA ----
// techniques and recipes are no longer bundled as JS — they're fetched from
// data/techniques.json and data/recipes.json at startup (see loadData()
// below). That's the actual "database" now: edit those .json files directly
// to add or change content, no JS knowledge required.
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

// ---- STATE ----
let currentRecipeId = 'ribeye';
let depthLevel = 1; // default: Standard, global across all steps
let panelOpenState = []; // per-step booleans, reset on recipe switch

function currentRecipe() { return recipes[currentRecipeId]; }

// ---- RENDER ----
function renderTabs() {
  const tabs = document.getElementById('recipeTabs');
  tabs.innerHTML = '';
  Object.keys(recipes).forEach(id => {
    const btn = document.createElement('button');
    btn.className = 'recipe-tab' + (id === currentRecipeId ? ' active' : '');
    btn.textContent = recipes[id].label;
    btn.addEventListener('click', () => {
      if (id === currentRecipeId) return;
      currentRecipeId = id;
      panelOpenState = recipes[id].steps.map(() => false);
      render();
      document.getElementById('content').scrollTop = 0;
    });
    tabs.appendChild(btn);
  });
}

function render() {
  renderTabs();
  const recipe = currentRecipe();
  document.getElementById('recipeTitle').textContent = recipe.title;

  const content = document.getElementById('content');
  content.innerHTML = '';

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
        chip.textContent = ing;
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
        render();
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
          render();
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

    content.appendChild(card);
  });

  const endMarker = document.createElement('p');
  endMarker.className = 'end-marker';
  endMarker.textContent = 'End of recipe';
  content.appendChild(endMarker);

  updateActiveStep();
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
  document.getElementById('stepProgress').textContent = `Step ${activeIndex + 1} of ${cards.length}`;
}

let scrollTicking = false;
document.addEventListener('DOMContentLoaded', () => {
  const content = document.getElementById('content');
  content.addEventListener('scroll', () => {
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
  panelOpenState = recipes[currentRecipeId].steps.map(() => false);
  render();
}
init();
