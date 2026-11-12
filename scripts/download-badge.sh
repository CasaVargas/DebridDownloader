#!/usr/bin/env bash
# Prints a shields.io endpoint badge (JSON) with the number of installer
# downloads across all published releases.
#
# The stock shields "downloads/total" badge is no use here: it sums every
# release asset, and the in-app updater fetches latest.json on each update
# check, then an update bundle (.app.tar.gz, .nsis.zip, .msi.zip,
# .AppImage.tar.gz) and its .sig. More than half of that total was updater
# traffic. This counts only the files a person downloads to install the app.
#
# Usage: scripts/download-badge.sh [owner/repo]   (needs gh and jq)
set -euo pipefail

repo="${1:-${GITHUB_REPOSITORY:-CasaVargas/DebridDownloader}}"

gh api "repos/${repo}/releases" --paginate \
  --jq '.[] | select(.draft | not) | .assets[]
        | select(.name | test("\\.(dmg|exe|msi|AppImage|deb|rpm)$"))
        | .download_count' \
  | jq -sc '{schemaVersion: 1, label: "downloads", message: (add // 0 | tostring), color: "blue"}'
