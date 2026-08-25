// ---- GENERIC PERSISTED STORAGE ----
//
// Two backends, tried in order:
//   1. window.storage — Claude's artifact storage API. Only exists inside a
//      Claude.ai chat preview. Handy for testing while we build.
//   2. localStorage — the real, standard browser storage this app actually
//      relies on once it's live outside of Claude (GitHub Pages, Capacitor).
//
// Both wrapped in try/catch: localStorage can throw in some contexts (e.g.
// certain private-browsing modes), so we fail quietly rather than break the
// app over a preference not saving.

async function getStoredValue(key) {
  if (window.storage) {
    try {
      const result = await window.storage.get(key, false);
      if (result && result.value !== undefined) return result.value;
    } catch (err) {
      // Key doesn't exist yet — expected, not an error.
    }
  }
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

async function setStoredValue(key, value) {
  if (window.storage) {
    try {
      await window.storage.set(key, value, false);
    } catch (err) {
      console.error(`Could not save "${key}" (window.storage):`, err);
    }
  }
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // localStorage unavailable — nothing more we can do here.
  }
}

async function deleteStoredValue(key) {
  if (window.storage) {
    try {
      await window.storage.delete(key, false);
    } catch (err) {
      // Fine if it didn't exist.
    }
  }
  try {
    localStorage.removeItem(key);
  } catch (err) {
    // localStorage unavailable — nothing more we can do here.
  }
}

// ---- Depth preference ----
async function loadDepthPreference() {
  const stored = await getStoredValue('default-depth-level');
  if (stored !== null && stored !== undefined) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) depthLevel = parsed;
  }
}

async function saveDepthPreference(level) {
  await setStoredValue('default-depth-level', String(level));
}

// ---- In-progress recipe (for the resume banner) ----
async function loadProgress() {
  const stored = await getStoredValue('last-progress');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch (err) {
    return null;
  }
}

async function saveProgress(recipeId, stepIndex) {
  await setStoredValue('last-progress', JSON.stringify({ recipeId, stepIndex }));
}

async function clearProgress() {
  await deleteStoredValue('last-progress');
}
