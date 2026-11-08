#!/bin/sh
# Installs this repo's Claude Code plugins (Effect tsgo LSP) on the current machine.
# Runs from `pnpm install` (prepare) so headless/remote agents get it too.
# Idempotent, and never fails the install.
set -u
cd "$(dirname "$0")/.." || exit 0

command -v claude >/dev/null 2>&1 || { echo "setup-claude: claude CLI not found, skipping"; exit 0; }

REPO=lgonzalezrouco/l-factory
MARKETPLACE=l-factory
PLUGIN=effect-tsgo-lsp@$MARKETPLACE

if ! claude plugin marketplace list 2>/dev/null | grep -q "❯ $MARKETPLACE\$"; then
  claude plugin marketplace add "$REPO" --scope project >/dev/null 2>&1 \
    || echo "setup-claude: could not add marketplace $REPO"
fi

if ! claude plugin list 2>/dev/null | grep -q "$PLUGIN"; then
  claude plugin install "$PLUGIN" --scope project >/dev/null 2>&1 \
    || echo "setup-claude: could not install $PLUGIN"
fi

echo "setup-claude: $PLUGIN ready"
exit 0
