import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createServer } from "http";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// dist/cli/index.js → dist/viewer.js
const viewerPath = resolve(__dirname, "../viewer.js");

const args = process.argv.slice(2);
const configFlag = args.indexOf("--config");
const portFlag = args.indexOf("--port");

const configPath = configFlag !== -1 ? args[configFlag + 1] : "axon-graph.json";
const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : 4242;

const resolvedConfig = resolve(process.cwd(), configPath);

if (!existsSync(resolvedConfig)) {
  console.error(`[axon-graph] Config file not found: ${resolvedConfig}`);
  console.error(`  Usage: npx axon-graph --config axon-graph.json`);
  process.exit(1);
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Axon Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #070a10; overflow: hidden; font-family: monospace; color: #e2e8f0; }
    #graph { width: 100vw; height: 100vh; }
    #panel {
      display: none;
      position: fixed; top: 16px; right: 16px; width: 300px;
      background: rgba(10,12,20,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; padding: 20px;
      font-size: 13px; z-index: 100;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      max-height: 80vh; overflow-y: auto;
    }
    #panel.open { display: block; }
    .panel-type { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
    .panel-title { font-size: 16px; font-weight: 700; color: #f1f5f9; }
    .panel-close { background: none; border: none; color: #64748b; cursor: pointer; font-size: 20px; line-height: 1; }
    .panel-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .section { margin-bottom: 12px; }
    .section-label { font-size: 11px; color: #64748b; margin-bottom: 6px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-healthy  { background: #1a4a1a; color: #4ade80; }
    .badge-degraded { background: #4a3a00; color: #fbbf24; }
    .badge-failing  { background: #4a1a1a; color: #f87171; }
    .badge-unknown  { background: #2a2a2a; color: #9ca3af; }
    .reason { margin-top: 6px; font-size: 11px; color: #94a3b8; font-style: italic; }
    .check { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; }
    .check-header { display: flex; justify-content: space-between; margin-bottom: 3px; }
    .check-name { font-weight: 600; font-size: 12px; }
    .check-msg { font-size: 11px; color: #94a3b8; }
    #timestamp { position: fixed; bottom: 12px; left: 12px; font-size: 11px; color: #374151; }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div id="panel">
    <div class="panel-header">
      <div>
        <div class="panel-type" id="panel-type"></div>
        <div class="panel-title" id="panel-title"></div>
      </div>
      <button class="panel-close" id="panel-close">×</button>
    </div>
    <div id="panel-body"></div>
  </div>
  <div id="timestamp"></div>
  <script type="module" src="/viewer.js"></script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === "/api/axon") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(readFileSync(resolvedConfig, "utf-8"));
    return;
  }

  if (req.url === "/viewer.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(readFileSync(viewerPath));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  axon-graph viewer running at ${url}`);
  console.log(`  Open the URL in your browser.`);
  console.log(`  Config: ${resolvedConfig}\n`);
});
