const selfsigned = require("selfsigned");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const attrs = [{ name: "commonName", value: "localhost" }];
  const opts = {
    days: 365,
    algorithm: "sha256",
    keySize: 2048,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] },
    ],
  };

  const pems = await selfsigned.generate(attrs, opts);

  const certDir = path.join(__dirname, ".cert");
  fs.mkdirSync(certDir, { recursive: true });

  fs.writeFileSync(path.join(certDir, "cert.pem"), pems.cert);
  fs.writeFileSync(path.join(certDir, "key.pem"), pems.private);
  console.log("✅ Certificates generated to .cert/");
  console.log("Fingerprint:", pems.fingerprint);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
