.PHONY: help release-beta release-patch release-minor release-major release-dry-run

# Disable gpg signing just for these targets (project rule: never sign)
NOSIGN := GIT_CONFIG_COUNT=2 \
  GIT_CONFIG_KEY_0=tag.gpgsign GIT_CONFIG_VALUE_0=false \
  GIT_CONFIG_KEY_1=commit.gpgsign GIT_CONFIG_VALUE_1=false

# ── Public-beta release mode ────────────────────────────────────────────────
# While wigolo is in public beta, every release is a pre-release:
#   * the version carries a -beta.N suffix, so npm marks the version as a
#     prerelease and semver ^/~ ranges won't auto-pick it up;
#   * the GitHub Release is flagged as a pre-release (see
#     .github/workflows/release.yml).
# It still publishes to the `latest` dist-tag, so `npm install wigolo` and
# `npx wigolo` keep working during the beta.
#
# TO GO STABLE later: switch the `prerelease`/`pre*` bumps below back to plain
# `patch` / `minor` / `major`, and remove `--prerelease` from
# .github/workflows/release.yml. (PREID is then unused.)
PREID := beta

help:  ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

release-beta:  ## Next beta on the current line (…-beta.N -> beta.N+1), tag, push
	$(NOSIGN) npm version prerelease --preid=$(PREID)
	git push --follow-tags

release-patch:  ## Start beta of the next patch (x.y.z -> x.y.(z+1)-beta.0), tag, push
	$(NOSIGN) npm version prepatch --preid=$(PREID)
	git push --follow-tags

release-minor:  ## Start beta of the next minor (x.y.z -> x.(y+1).0-beta.0), tag, push
	$(NOSIGN) npm version preminor --preid=$(PREID)
	git push --follow-tags

release-major:  ## Start beta of the next major (x.y.z -> (x+1).0.0-beta.0), tag, push
	$(NOSIGN) npm version premajor --preid=$(PREID)
	git push --follow-tags

release-dry-run:  ## Build and preview npm tarball (no publish, no tag)
	rm -rf dist
	npm run build
	npm publish --dry-run
