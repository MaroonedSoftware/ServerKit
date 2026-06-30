#!/usr/bin/env bash
set -euo pipefail

# Bootstrap publish + trusted-publisher config for public workspace packages.
# Run LOCALLY from the repo root. Idempotent: skips packages already published
# and already trusted, so re-run it whenever you add new packages.
#
# Why this exists: npm OIDC trusted publishing (used by .github/workflows/deploy.yml)
# can only publish to a package that already exists AND has a trusted publisher
# configured. Neither is true for a brand-new package, so the first publish + trust
# setup has to happen once, locally, with your own credentials. This script does that.
#
# Requirements:
#   - npm >= 11.5.1, Node >= 22.14   (npm trust lives here)
#   - npm login  as a @maroonedsoftware member with publish/create rights
#   - account-level 2FA enabled      (npm trust will prompt for an OTP)
#
# Tip for bulk runs: on npmjs.com, after the first OTP prompt enable
# "skip 2FA for the next 5 minutes" so later packages don't re-prompt.

WORKFLOW_FILE="release.yml"          # the workflow that performs the OIDC publish
REPO="MaroonedSoftware/ServerKit"    # owner/repo the trusted publisher lives in

# --- fail fast -------------------------------------------------------------
npm whoami >/dev/null 2>&1 || { echo "Not logged in. Run: npm login"; exit 1; }

# npm trust requires npm >= 11.5.1; bail early with a clear message if too old.
req="11.5.1"; cur="$(npm -v)"
if [ "$(printf '%s\n%s\n' "$req" "$cur" | sort -V | head -1)" != "$req" ]; then
  echo "npm $cur is too old: 'npm trust' needs >= $req."
  echo "Upgrade with:  npm install -g npm@latest"
  exit 1
fi

# Build the whole workspace once so every dist/ is ready to publish.
echo "Building workspace..."
pnpm build

# --- per-package -----------------------------------------------------------
for dir in packages/*/; do
  pkg_json="${dir}package.json"
  [ -f "$pkg_json" ] || continue

  name=$(node -p "require('./$pkg_json').name")
  is_private=$(node -p "require('./$pkg_json').private === true")
  if [ "$is_private" = "true" ]; then
    echo "skip:     $name (private)"
    continue
  fi

  # 1. create on the registry if missing
  if npm view "$name" version >/dev/null 2>&1; then
    echo "exists:   $name"
  else
    echo "publish:  $name (first publish)"
    ( cd "$dir" && npm publish --access public )
  fi

  # 2. verify/fix trusted publisher: leave it alone if it already points at the
  #    right repo+workflow, otherwise revoke the stale config and recreate it.
  raw="$(npm trust list "$name" --json 2>/dev/null || true)"
  state="$(REPO="$REPO" WF="$WORKFLOW_FILE" RAW="$raw" node -e '
    const raw = process.env.RAW || "";
    let data; try { data = JSON.parse(raw); } catch { console.log("NONE"); process.exit(0); }
    const arr = Array.isArray(data)
      ? data
      : (data.trustedPublishers || data.publishers || data.configs || data.results || (data.id ? [data] : []));
    if (!arr || arr.length === 0) { console.log("NONE"); process.exit(0); }
    const repo = process.env.REPO, wf = process.env.WF;
    const blob = (c) => JSON.stringify(c);
    if (arr.some((c) => blob(c).includes(repo) && blob(c).includes(wf))) { console.log("OK"); process.exit(0); }
    let id;
    const findId = (o) => { if (!o || typeof o !== "object") return; for (const k of Object.keys(o)) {
      if (k === "id" && (typeof o[k] === "string" || typeof o[k] === "number")) { id = String(o[k]); return; }
      findId(o[k]); } };
    arr.forEach(findId);
    console.log("MISMATCH:" + (id || ""));
  ')"

  case "$state" in
    OK)
      echo "trusted:  $name (already correct)"
      ;;
    MISMATCH:*)
      bad_id="${state#MISMATCH:}"
      echo "fixing:   $name (stale config -> $REPO / $WORKFLOW_FILE)"
      if [ -n "$bad_id" ]; then
        npm trust revoke "$name" --id="$bad_id" || echo "  WARN: revoke failed for $name (id=$bad_id)" >&2
      else
        echo "  WARN: could not read existing trust id for $name; trying to recreate" >&2
      fi
      npm trust github "$name" --repository "$REPO" --file "$WORKFLOW_FILE" --allow-publish --yes \
        || echo "  WARN: trust config failed for $name (OTP needed?)" >&2
      sleep 2
      ;;
    *)  # NONE (or unreadable list, e.g. not authed)
      echo "trusting: $name"
      npm trust github "$name" --repository "$REPO" --file "$WORKFLOW_FILE" --allow-publish --yes \
        || echo "  WARN: trust config failed for $name (already set? OTP needed?)" >&2
      sleep 2
      ;;
  esac
done

echo "Done."
