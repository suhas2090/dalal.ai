(async function loadComponents() {
  const nodes = Array.from(document.querySelectorAll('[data-include]'));

  for (const node of nodes) {
    const file = node.getAttribute('data-include');
    try {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
      node.outerHTML = await response.text();
    } catch (error) {
      console.error(error);
      node.outerHTML = `<!-- include failed: ${file} -->`;
    }
  }

  const appScript = document.createElement('script');
  const includesScriptUrl = new URL((document.currentScript && document.currentScript.src) || 'includes.js', window.location.href);
  appScript.src = new URL('script.js', includesScriptUrl).toString();
  document.body.appendChild(appScript);
})();
