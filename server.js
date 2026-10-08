const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon'
};

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }

    let filePath = path.normalize(path.join(ROOT, pathname));

    // Prevent directory traversal
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    // If directory, check for index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>404 Not Found</title></head>
            <body style="font-family:sans-serif;background:#0a0e1a;color:#e2e8f0;padding:3rem;text-align:center;">
              <h1 style="color:#ef4444;">404 — Page Not Found</h1>
              <p>The requested file <code>${pathname}</code> does not exist.</p>
              <p><a href="/" style="color:#00d4ff;">Return to Home</a></p>
            </body>
            </html>
          `);
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error: ' + err.message);
        }
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ SmartEnergy Monitor Server Running!`);
  console.log(`📡 Local URL:   http://localhost:${PORT}`);
  console.log(`👑 Admin Setup: http://localhost:${PORT}/admin-setup.html`);
  console.log(`🔑 Login Page:  http://localhost:${PORT}/login.html`);
  console.log(`🔌 Web Serial: Enabled (Secure localhost context)`);
  console.log(`======================================================\n`);
  console.log(`Press Ctrl+C to stop.\n`);
});
