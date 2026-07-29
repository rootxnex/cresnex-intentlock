.PHONY: fmt build test gas coverage experiments web-install web-check check
fmt:
	cd contracts && forge fmt src test script
build:
	cd contracts && forge build
test:
	cd contracts && forge test
gas:
	cd contracts && forge snapshot
experiments:
	cd contracts && forge test --match-contract AcademicBaselinesTest --fuzz-runs 30 -vv
coverage:
	cd contracts && forge coverage --ir-minimum
web-install:
	cd web && npm ci
web-check:
	cd web && npm run test:sdk && npm run lint && npm run typecheck && npm run build
check: fmt build test web-check
