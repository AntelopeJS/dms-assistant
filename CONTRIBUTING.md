# Contributing to AntelopeJS

Thank you for helping improve AntelopeJS.

## Before you start

- Search existing issues and discussions before opening a new one.
- Use an issue to discuss substantial features or behavior changes first.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

Each repository documents its prerequisites and commands in its README. Most
AntelopeJS JavaScript projects use Node.js and pnpm.

1. Fork or clone the repository.
2. Create a focused branch from the default branch.
3. Install dependencies with the lockfile intact.
4. Make the smallest change that solves the problem.
5. Run the repository's formatting, linting, type-checking, and test commands.
6. Add or update documentation and tests when behavior changes.

Do not commit generated artifacts, credentials, or unrelated formatting
changes unless the repository explicitly requires them.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit and
pull request titles, for example `fix(api): handle an empty response`.

Pull requests should:

- explain the problem and the chosen solution;
- link the relevant issue or discussion;
- call out breaking changes and migration steps;
- include evidence that the change was tested;
- remain small enough to review safely.

Maintainers may ask for changes before merging. AntelopeJS repositories
normally squash pull requests, so the pull request title becomes the commit on
the default branch.

## The imported history

This repository merges `AntelopeJS/dms-ai` and `AntelopeJS/dms-builder`, with
the history of both. `scripts/import-history.sh` builds it, and
`scripts/import-history.tips` records the last dms-ai and dms-builder commits
it imported. The script needs `git filter-repo` and a clean working tree.

- dms-ai commits keep their hashes: dms-ai sits at the root with its original
  paths.
- dms-builder commits are rewritten: `git filter-repo` keeps
  `packages/dms-builder` and the builder's agent skills and moves the package
  under `builder/`, so each commit gets a new hash.

To bring in commits merged upstream after the import, run the script again
from an up-to-date `main`, with the refs to import (both default to `main`):

```bash
scripts/import-history.sh [dms-ai ref] [dms-builder ref]
```

It fetches both refs, cherry-picks the commits after the recorded tips with
`-x`, and commits the new tips. A commit that touches a file this repository
has since moved, such as `builder/src` now under `src/builder`, conflicts:
resolve it at the new path. The script stops if an upstream history was
rewritten after the recorded tip.

To carry over an open branch:

- **A dms-ai branch** rebases as it is, since dms-ai hashes are unchanged:
  `git fetch https://github.com/AntelopeJS/dms-ai.git <branch>`, then
  `git rebase --onto main <recorded dms-ai tip> FETCH_HEAD`.
- **A dms-builder branch** has to be rewritten first. Run
  `git filter-repo` on a clone of the branch with the same `--path` and
  `--path-rename` arguments as the script, so its commits live under
  `builder/`. Then rebase the commits after its merge base with dms-builder
  `main` onto this repository's `main`, resolving each move to its new path.

## Releases

Maintainers publish from GitHub Actions. Stable releases (`latest`) come from
the default branch and prereleases (`next`) come from a branch named `next`.
See the organization-wide
[release channels](https://github.com/AntelopeJS/.github/blob/main/CONTRIBUTING.md#release-channels)
guide for the full workflow.
