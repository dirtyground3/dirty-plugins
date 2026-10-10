"use strict";
// Standalone synthetic browser acceptance for the authored exact scoring module.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const esbuild = require("esbuild");
const { requireSource } = require("./plugin_paths");
const stopFile = process.argv[2];
if (!stopFile) throw new Error("Pass a workspace-local stop-file path");
const scores = requireSource("DirtyRank", "src/domain/scores.ts");
const entries = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), rating: 500 + (i / 5000) * 1500 }));
const expected = Array.from(scores.buildCategoryScoreIndex(entries).performers.values()).reduce(
  (sum, group, i) => sum + (i + 1) * group.score.rating,
  0,
);
const source = `
import { buildCategoryScoreIndexAsync } from "./plugins/DirtyRank/src/domain/scores";
const entries = Array.from({length:5000},(_,i)=>({id:String(i),rating:500+(i/5000)*1500}));
const output = document.getElementById("result")!;
const start = document.getElementById("start") as HTMLButtonElement;
const cancel = document.getElementById("cancel") as HTMLButtonElement;
const NativeChannel = window.MessageChannel;
let taskStart = 0, longest = 0, tasks = 0, controller: AbortController | null = null;
class MeasuredChannel {
  port1; port2;
  constructor() {
    const channel = new NativeChannel();
    this.port1 = {
      set onmessage(callback: () => void) {
        channel.port1.onmessage = () => { taskStart = performance.now(); callback(); };
      }, close: () => channel.port1.close()
    };
    this.port2 = {postMessage: (value: unknown) => {
      longest = Math.max(longest, performance.now()-taskStart); tasks++;
      channel.port2.postMessage(value);
    }, close: () => channel.port2.close()};
  }
}
window.MessageChannel = MeasuredChannel as unknown as typeof MessageChannel;
cancel.onclick = () => controller?.abort();
start.onclick = async () => {
  controller = new AbortController(); start.disabled = true; cancel.disabled = false;
  longest = 0; tasks = 0; let ticks = 0;
  output.textContent = "Calculating complete scores…";
  const heartbeat = setInterval(() => { ticks++; }, 1);
  const began = performance.now();
  try {
    for (let category=0;category<3;category++) {
      taskStart=performance.now();
      const index = await buildCategoryScoreIndexAsync(entries,controller.signal);
      longest = Math.max(longest,performance.now()-taskStart);
      const checksum = Array.from(index.performers.values()).reduce((sum,g,i)=>sum+(i+1)*g.score.rating,0);
      if (Math.abs(checksum-${expected})>0.00001) throw new Error("Score checksum mismatch");
    }
    output.textContent = "PASS: 5,000 performers × 3 categories. Exact checksum preserved. " +
      "Browser input heartbeat: "+ticks+" ticks during calculation. " +
      "Comparison tasks: "+tasks+". Longest measured task: "+longest.toFixed(2)+" ms. " +
      "Total: "+(performance.now()-began).toFixed(1)+" ms.";
  } catch(error) {
    output.textContent = (error as Error).name === "AbortError" ? "Cancelled; no partial scores published." : String(error);
  } finally { clearInterval(heartbeat); start.disabled=false; cancel.disabled=true; }
};
`;
const bundle = esbuild.buildSync({
  stdin: { contents: source, resolveDir: path.resolve("."), loader: "ts" },
  bundle: true,
  write: false,
  format: "iife",
  target: "es2020",
  minify: true,
}).outputFiles[0].text;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>DirtyRank cold scoring acceptance</title><style>
body{font:18px/1.6 system-ui;margin:48px auto;max-width:850px;padding:20px;background:#18232c;color:#edf3f5}
button{font:inherit;padding:10px 20px;margin:10px 10px 10px 0;border:1px solid #74b9b0;border-radius:8px;background:#263c48;color:inherit}
button:disabled{opacity:.45}output{display:block;margin-top:24px;padding:24px;border:1px solid #74b9b0;border-radius:10px}
</style><h1>DirtyRank cold scoring acceptance</h1><p>5,000 synthetic performers. Three exact category calculations.
The production scoring module yields between bounded comparison batches.</p>
<button id="start">Calculate scores</button><button id="cancel" disabled>Cancel</button>
<output id="result" aria-live="polite">Ready.</output><script src="/app.js"></script></html>`;
const server = http.createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  response.setHeader("content-type", request.url === "/app.js" ? "application/javascript" : "text/html");
  response.end(request.url === "/app.js" ? bundle : html);
});
server.listen(0, "127.0.0.1", () => console.log("BROWSER_FIXTURE http://127.0.0.1:" + server.address().port));
const poll = setInterval(() => {
  if (fs.existsSync(stopFile)) {
    clearInterval(poll);
    server.close(() => process.exit(0));
  }
}, 250);
