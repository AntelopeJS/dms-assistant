#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/import-history.sh [dms-ai ref] [dms-builder ref]"
[ $# -le 2 ] || { echo "$usage" >&2; exit 2; }
ai_ref=${1:-main}
builder_ref=${2:-main}
repo=$(git rev-parse --show-toplevel)
tips="$repo/scripts/import-history.tips"
origin=${IMPORT_ORIGIN:-https://github.com/AntelopeJS}
work=$(mktemp -d "${TMPDIR:-/tmp}/dms-assistant-import.XXXXXX")
trap 'rm -rf "$work"' EXIT

git filter-repo --version >/dev/null 2>&1 || {
  echo "git filter-repo is required: pip install git-filter-repo" >&2
  exit 1
}
[ -z "$(git -C "$repo" status --porcelain)" ] || {
  echo "commit or stash your changes first" >&2
  exit 1
}

git clone --quiet --no-tags --single-branch --branch "$builder_ref" \
  "$origin/dms-builder.git" "$work/dms-builder"
git -C "$work/dms-builder" filter-repo --quiet --force \
  --path packages/dms-builder/ \
  --path PRD-data-sources.md \
  --path docs/captures.ts \
  --path docs/tsconfig.json \
  --path .agents/skills/verify-dms-builder/ \
  --path .agents/skills/formal-page-save/ \
  --path .claude/skills/verify-dms-builder \
  --path .claude/skills/formal-page-save \
  --path .github/readme/strip-builder.svg \
  --path-rename packages/dms-builder/:builder/ \
  --path-rename PRD-data-sources.md:builder/docs/design/PRD-data-sources.md \
  --path-rename docs/captures.ts:builder/docs/captures.ts \
  --path-rename docs/tsconfig.json:builder/docs/tsconfig.json >/dev/null

git -C "$repo" fetch --quiet --no-tags "$origin/dms-ai.git" "+$ai_ref:refs/import/dms-ai"
git -C "$repo" fetch --quiet --no-tags "$work/dms-builder" "+$builder_ref:refs/import/dms-builder"
ai=$(git -C "$repo" rev-parse refs/import/dms-ai)
builder=$(git -C "$repo" rev-parse refs/import/dms-builder)

if ! git -C "$repo" rev-parse --verify --quiet HEAD >/dev/null; then
  git -C "$repo" reset --quiet --hard "$ai"
  git -C "$repo" merge --quiet --no-edit --allow-unrelated-histories \
    -m "chore: import dms-builder ($builder_ref)" \
    -m "dms-builder $builder, rewritten by scripts/import-history.sh" "$builder"
  exit 0
fi

[ -f "$tips" ] || { echo "$tips is missing" >&2; exit 1; }
last() { awk -v name="$1" '$1 == name { print $2 }' "$tips"; }
for name in dms-ai dms-builder; do
  from=$(last "$name")
  git -C "$repo" merge-base --is-ancestor "$from" "refs/import/$name" || {
    echo "$name: $from is not an ancestor of the new ref; was its history rewritten?" >&2
    exit 1
  }
  if [ -n "$(git -C "$repo" rev-list "$from..refs/import/$name")" ]; then
    git -C "$repo" cherry-pick -x --empty=drop "$from..refs/import/$name" >/dev/null
  fi
done
printf 'dms-ai %s\ndms-builder %s\n' "$ai" "$builder" >"$tips"
if [ -n "$(git -C "$repo" status --porcelain -- "$tips")" ]; then
  git -C "$repo" commit --quiet -m "chore: record the imported dms-ai and dms-builder commits" -- "$tips"
fi
