[简体中文](CONTRIBUTING.md) · [English](CONTRIBUTING_en.md)

# Contributing — Getting involved with dsh-zhihu-search

Issues and PRs are filed on [GitHub](https://github.com/dsh-plugin-lab/dsh-zhihu-search).

## When filing a bug

- Plugin version, DSH version (`dsh --version`), Node version (`node --version`).
- Installed from source or from npm; whether DSH was restarted after the change.
- A minimal reproduction, and the full error text.

## Before proposing a feature

- Read [.agents/notes/](.agents/notes/) — proposals already rejected by measurement, along with the alternatives each decision ruled out.
- What the design and the platform will not do → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Before opening a PR

- Run `npm test` in the repository directory.
- Read "全局规则" in [AGENTS.md](AGENTS.md) and [test/README.md](test/README.md): merge criteria live there, and the red lines are pinned by [test/redlines.test.ts](test/redlines.test.ts).
- Do not modify the version number (release process → [docs/PUBLISHING.md](docs/PUBLISHING.md)).
