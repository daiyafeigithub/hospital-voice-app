const { createServer } = require("https");
const { parse } = require("url");
const next = require("next");
const { readFileSync, existsSync } = require("fs");
const { join } = require("path");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const certDir = dev
  ? join(__dirname, ".cert")
  : join(__dirname, ".cert", "production");
const certPath = join(certDir, "cert.pem");
const keyPath = join(certDir, "key.pem");

if (!existsSync(certPath) || !existsSync(keyPath)) {
  console.error("HTTPS certificates missing:", certPath, keyPath);
  console.error("Falling back to HTTP mode...");
  app.prepare().then(() => {
    const http = require("http");
    const port = parseInt(process.env.PORT || "3000", 10);
    http
      .createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
      })
      .listen(port, () => {
        console.log(`> HTTP server ready on http://localhost:${port}`);
      });
  });
} else {
  const httpsOptions = {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };

  const port = parseInt(process.env.PORT || "3000", 10);

  app.prepare().then(() => {
    createServer(httpsOptions, (req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    }).listen(port, () => {
      console.log(`> HTTPS server ready on https://localhost:${port}`);
    });
  });
}
