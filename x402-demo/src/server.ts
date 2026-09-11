import { loadConfig } from "./config.js";
import { createDemoApp } from "./payment.js";

const config = loadConfig();
createDemoApp(config).listen(config.port, () => {
  console.log(`IntentLock x402 demo listening at ${config.resourceUrl}`);
});
