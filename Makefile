# ruflo-source-patch — local install / publish
#
# The default registry (npm config get registry) is the local Verdaccio. Override the
# registry for any target with:  make publish-local REGISTRY=http://localhost:4873

REGISTRY ?= $(shell npm config get registry)
PKG      := $(shell node -e "console.log(require('./package.json').name)")
VERSION  := $(shell node -e "console.log(require('./package.json').version)")

.PHONY: help install uninstall test install-global link unlink pack publish-local unpublish-local whoami

# One command: global-install the package, apply every patch target — the three CLI ones
# AND the two ruflo-adr plugin ones — materialize adr-reindex, and schedule the monitor
# that keeps them applied. This is the whole setup.
#
# adr-reindex ships with the ADR pair on purpose: the patched importer's ORPHANS message
# tells you to run that script, and an instruction pointing at a file that was never
# installed is the same silent lie this package exists to kill. The other script targets
# (dual, dedupe) are project scaffolding, not fixes — they stay opt-in.
install: install-global
	ruflo-source-patch cwd install
	ruflo-source-patch daemon install
	ruflo-source-patch memory install
	ruflo-source-patch adr-template install
	ruflo-source-patch adr-index install
	ruflo-source-patch adr-reindex install
	ruflo-source-patch monitor install
	@echo ""
	@echo "done — cwd + daemon + memory + adr-template + adr-index patched, adr-reindex installed,"
	@echo "       monitor scheduled. Verify: ruflo-source-patch monitor check"

# The inverse: remove every target this Makefile's `install` added (the last patch target
# removed also drops the SessionStart hook), then uninstall the global package. Leaves the
# machine as it was.
uninstall:
	-ruflo-source-patch monitor uninstall
	-ruflo-source-patch adr-reindex uninstall
	-ruflo-source-patch adr-index uninstall
	-ruflo-source-patch adr-template uninstall
	-ruflo-source-patch memory uninstall
	-ruflo-source-patch daemon uninstall
	-ruflo-source-patch cwd uninstall
	npm uninstall -g $(PKG) 2>/dev/null || true
	@echo "done — patches reverted, hook + monitor removed, package uninstalled"


help:
	@echo "ruflo-source-patch  $(PKG)@$(VERSION)"
	@echo "  registry: $(REGISTRY)"
	@echo ""
	@echo "  make install          global-install + apply ALL patch targets (CLI + ruflo-adr)"
	@echo "                        + adr-reindex + schedule monitor"
	@echo "  make uninstall        revert everything and remove the package"
	@echo "  make test             property fuzz (npm test)"
	@echo "  make install-global   npm pack + npm i -g the tarball (real global install)"
	@echo "  make link             npm link (symlink into the global prefix, dev)"
	@echo "  make unlink           undo make link"
	@echo "  make pack             build the .tgz only"
	@echo "  make publish-local    publish this version to \$$REGISTRY"
	@echo "  make unpublish-local  remove this version from \$$REGISTRY"
	@echo "  make whoami           who am I on \$$REGISTRY"

test:
	npm test

# Real install: pack to a tarball, then install THAT globally — same bytes a user gets
# from the registry, so it catches a broken `files` list or a bad bin path. Idempotent.
install-global: pack
	npm install -g ./$(shell npm pack --silent)

# Dev install: symlink the working tree into the global prefix. `ruflo-source-patch`
# then runs live source with no reinstall between edits.
link:
	npm link

unlink:
	npm unlink -g $(PKG) 2>/dev/null || true

pack:
	npm pack

# Publish to the local Verdaccio. --registry keeps it OFF npmjs.org even if the default
# ever changes. Fails loudly if this exact version is already published (bump first).
publish-local:
	npm publish --registry $(REGISTRY)
	@echo "published $(PKG)@$(VERSION) -> $(REGISTRY)"

unpublish-local:
	npm unpublish $(PKG)@$(VERSION) --registry $(REGISTRY) --force

whoami:
	@npm whoami --registry $(REGISTRY) 2>&1 | grep -vE 'warn|python' || true
