import { loadConfig } from "./config.js";
import { createDemoApp } from "./payment.js";
import express from "express";
import path from "node:path";

const config = loadConfig();
const app = express();
const publicDir = path.join(process.cwd(), "public");
app.get("/", (_request, response) => response.sendFile(path.join(publicDir, "index.html")));
app.use(express.static(publicDir));
app.use(createDemoApp(config));
app.listen(config.port, "127.0.0.1", () => {
  console.log(`IntentLock x402 demo listening at ${config.resourceUrl}`);
});
