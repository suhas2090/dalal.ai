(async function loadComponents() {
  const nodes = Array.from(document.querySelectorAll('[data-include]'));
  
  for (const node of nodes) {
    let file = node.getAttribute('data-include');
    
    // If the HTML file is in a subdirectory (e.g., /dashboard/index.html)
    // and the data-include path doesn't already start with "../" or "/"
    // we need to prepend "../" to go up one level
    const currentPath = window.location.pathname;
    const isInSubdirectory = currentPath.includes('/dashboard/') || 
                             currentPath.includes('/signup/') || 
                             currentPath.includes('/homepage/');
    
    if (isInSubdirectory && !file.startsWith('../') && !file.startsWith('/')) {
      file = '../' + file;
    }
    
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
  
  // Same fix for script.js path
  let scriptPath = new URL('script.js', includesScriptUrl).toString();
  const currentPath = window.location.pathname;
  const isInSubdirectory = currentPath.includes('/dashboard/') || 
                           currentPath.includes('/signup/') || 
                           currentPath.includes('/homepage/');
  
  if (isInSubdirectory) {
    scriptPath = new URL('../assets/js/script.js', window.location.href).toString();
  }
  
  appScript.src = scriptPath;
  document.body.appendChild(appScript);
})();
