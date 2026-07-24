.PHONY: fmt build test gas coverage web-install web-check check
fmt:
	cd contracts && forge fmt src test script
build:
	cd contracts && forge build
test:
	cd contracts && forge test
gas:
	cd contracts && forge snapshot
coverage:
	cd contracts && forge coverage
web-install:
	cd web && npm ci
web-check:
	cd web && npm run lint && npm run typecheck && npm run build
check: fmt build test web-check
