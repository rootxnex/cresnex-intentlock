import { signFreshPayment } from "./manual-sign.js";

declare global { interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } } }
const account = document.querySelector("#account")!;
const chain = document.querySelector("#chain")!;
const output = document.querySelector<HTMLTextAreaElement>("#signature")!;
const button = document.querySelector<HTMLButtonElement>("#sign")!;
const copy = document.querySelector<HTMLButtonElement>("#copy")!;

async function refresh(): Promise<void> {
  if (!window.ethereum) { account.textContent = "MetaMask not detected"; return; }
  const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
  account.textContent = accounts[0] ?? "Not connected";
  const id = await window.ethereum.request({ method: "eth_chainId" }) as string;
  chain.textContent = `${id} (${BigInt(id)})`;
}
button.onclick = async () => {
  button.disabled = true; output.value = "";
  try { output.value = await signFreshPayment(window.ethereum!); await refresh(); }
  catch (error) { output.value = error instanceof Error ? error.message : String(error); }
  finally { button.disabled = false; }
};
copy.onclick = async () => { if (output.value) await navigator.clipboard.writeText(output.value); };
void refresh();
