# Seven-minute demonstration

1. Explain that an AI agent may submit a syntactically allowed action whose financial outcome is harmful.
2. Show the owner funding the local IntentLock account with mock USDC.
3. Open the dashboard, enter the agent address, choose **Valid swap** and sign its EIP-712 manifest as the owner.
4. Switch to the registered agent wallet and execute the saved package. Show recipient WETH and `IntentExecuted` in the live evidence timeline.
5. Switch back to the owner, choose **Overspending attack**, sign a newly generated package, then switch to the agent and submit it.
6. Compare pre/post account balance and router allowance: both harmful inner effects were restored.
7. Show the persisted evidence hash, reason selector, consumed nonce and strike.
8. Repeat authenticated **Wrong-recipient**, **Unlimited-approval** or **Hidden malicious batch** attacks until the third strike quarantines the agent.
9. Show that a fresh intent from the quarantined agent is rejected without target execution. Use the **Expired-intent authentication failure** template separately to show a rejection that does not add a strike.
10. As owner, unquarantine/reset or remove and replace the agent.
11. Close with the actual test, fuzz, invariant and gas outputs generated on the presentation machine.

Always call the tokens/router mocks and label the deployment a research prototype.
