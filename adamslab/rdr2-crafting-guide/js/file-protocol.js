// A classic script, not a module: on file:// the modules are
// blocked by CORS and never run, so this has to be what explains it.
// A file rather than inline so the page's Content-Security-Policy
// needs no hash for it.
if (location.protocol === 'file:') {
  document.getElementById('view').innerHTML =
    '<div class="error"><h2>This needs to be served over HTTP.</h2>' +
    '<p>Opened from a file path, the browser gives every file the origin ' +
    '<code>null</code> and blocks the modules and the database fetch.</p>' +
    '<p>From the project folder, run <code>python3 -m http.server 8000</code> ' +
    'and open <a href="http://localhost:8000">http://localhost:8000</a>.</p></div>';
}
