// ---- PERSISTED PREFERENCE: default explanation depth ----
//
// Two storage backends, tried in order:
//   1. window.storage — Claude's artifact storage API. Only exists when this
//      app is being viewed inside a Claude.ai chat preview. Handy for testing
//      while we build, but it will NOT exist once this is hosted on GitHub
//      Pages, opened as a plain file, or wrapped in Capacitor.
//   2. localStorage — the real, standard browser storage this app will
//      actually rely on once it's live outside of Claude. This is the
//      backend that matters long-term.
//
// Both are wrapped in try/catch: localStorage can throw in some contexts
// (e.g. certain private-browsing modes), so we fail quietly rather than
// break the app over a preference not saving.

async function loadDepthPreference() {
  if (window.storage) {
    try {
      const result = await window.storage.get('default-depth-level', false);
      if (result && result.value !== undefined) {
        applyStoredDepth(result.value);
        return;
      }
    } catch (err) {
      // Key doesn't exist yet on first run — expected, not an error.
    }
  }

  try {
    const stored = localStorage.getItem('default-depth-level');
    if (stored !== null) applyStoredDepth(stored);
  } catch (err) {
    // localStorage unavailable — app just uses the in-memory default.
  }
}

function applyStoredDepth(value) {
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) depthLevel = parsed;
}

async function saveDepthPreference(level) {
  if (window.storage) {
    try {
      await window.storage.set('default-depth-level', String(level), false);
    } catch (err) {
      console.error('Could not save depth preference (window.storage):', err);
    }
  }

  try {
    localStorage.setItem('default-depth-level', String(level));
  } catch (err) {
    // localStorage unavailable — nothing more we can do here.
  }
}
