# ruflo-source-patch — local install / publish
#
# The default registry (npm config get registry) is the local Verdaccio. Override the
# registry for any target with:  make publish-local REGISTRY=http://localhost:4873

REGISTRY ?= $(shell npm config get registry)
PKG      := $(shell node -e "console.log(require('./package.json').name)")
VERSION  := $(shell node -e "console.log(require('./package.json').version)")

.PHONY: help test install-global link unlink pack publish-local unpublish-local whoami

help:
	@echo "ruflo-source-patch  $(PKG)@$(VERSION)"
	@echo "  registry: $(REGISTRY)"
	@echo ""
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
