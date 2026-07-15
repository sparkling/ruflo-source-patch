# ADR-012: dedupe-bundle: strip the init bundle that duplicates the installed plugins

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: script-target, hygiene

## Context

`ruflo init --full` writes roughly 260 skill, command and agent files into the project. They duplicate the
installed `ruflo/*` plugins by 97 to 100 percent.

The cost is not only clutter: duplicated hooks DOUBLE-FIRE, and a project-local copy of a skill shadows the
plugin's own, so a plugin update silently stops taking effect for anything the bundle shadowed.

## Decision

A script that removes the bundled files which duplicate an installed plugin, and keeps anything
project-unique. Never a blanket delete: a `--dry-run` is the default posture, and a file with no plugin
counterpart is left alone.

## Consequences

### Positive

- Hooks stop firing twice.
- A plugin update takes effect, instead of being shadowed by a stale project copy.
- The repo stops carrying hundreds of files nobody wrote.

### Negative

- Deleting project files is inherently destructive, so this is the one script that must never guess. It is
  tested against a project-unique skill, which must survive.

### Neutral

- The alternative (init with the default preset rather than `--full`) avoids most of the bundle in the first
  place, and `ruflo-new-dual.sh` does exactly that.

## Links

- Upstream: [ruvnet/ruflo#2640](https://github.com/ruvnet/ruflo/issues/2640)
- `lib/dual/ruflo-dedupe-bundle.sh`
