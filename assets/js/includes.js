(async function loadComponents() {
  const includesScriptUrl = new URL((document.currentScript && document.currentScript.src) || 'includes.js', window.location.href);
  const projectRootUrl = new URL('../..', includesScriptUrl); // assets/js/ -> project root

  function includeCandidates(file) {
    const clean = (file || '').trim();
    if (!clean) return [];

    const candidates = [new URL(clean, window.location.href).toString()];

    // Fallback 1: root-relative candidate (helps when path was written for another route depth)
    const noParentPrefix = clean.replace(/^(\.\.\/)+/, '');
    candidates.push(new URL(noParentPrefix, projectRootUrl).toString());

    // Fallback 2: one-level-up relative candidate for subdirectory pages
    if (!clean.startsWith('../')) {
      candidates.push(new URL('../' + clean, window.location.href).toString());
    }

    return [...new Set(candidates)];
  }

  const nodes = Array.from(document.querySelectorAll('[data-include]'));

  for (const node of nodes) {
    const file = node.getAttribute('data-include');
    try {
      let html = null;
      let lastError = null;

      for (const url of includeCandidates(file)) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          html = await response.text();
          break;
        } catch (e) {
          lastError = e;
        }
      }

      if (html === null) throw new Error(`Failed to load include "${file}" (${lastError?.message || 'unknown error'})`);
      node.outerHTML = html;
    } catch (error) {
      console.error(error);
      node.outerHTML = `<!-- include failed: ${file} -->`;
    }
  }

  const appScript = document.createElement('script');
  appScript.src = new URL('script.js', includesScriptUrl).toString();
  document.body.appendChild(appScript);
})();
