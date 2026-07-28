#!/usr/bin/env bash
set -euo pipefail

manifest="${1:?usage: smoke-deployment.sh <deployment.json>}"
: "${RPC_URL:?set RPC_URL to the local or public-testnet endpoint}"

account_v2="$(jq -r '.accountV2' "$manifest")"
owner="$(jq -r '.owner' "$manifest")"
usdc="$(jq -r '.usdc' "$manifest")"
vault_a="$(jq -r '.vaultA' "$manifest")"
oracle="$(jq -r '.oracle' "$manifest")"

test "$(cast call "$account_v2" 'owner()(address)' --rpc-url "$RPC_URL" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$usdc" 'balanceOf(address)(uint256)' "$account_v2" --rpc-url "$RPC_URL" | awk '{print $1}')" = "1000000000000"
test "$(cast call "$oracle" 'price(address)(uint256)' "$vault_a" --rpc-url "$RPC_URL" | awk '{print $1}')" = "1000000000000000000"
test "$(cast code "$account_v2" --rpc-url "$RPC_URL")" != "0x"

echo "Deployment smoke check passed for $account_v2"
