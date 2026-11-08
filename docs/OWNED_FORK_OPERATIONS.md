# Owned Conway fork: Ubuntu, Codex and Overwatch

Primary Git repository: https://github.com/felfel-aly/automaton

This is an independently managed fork of MIT-licensed Conway Automaton.
It does not require upstream approval to build, test or merge its own code.

## Safe developer setup

    git clone https://github.com/felfel-aly/automaton.git
    cd automaton
    corepack enable
    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm audit --prod --audit-level=high
    pnpm audit --audit-level=high

On FELFEL Ubuntu WSL, Codex CLI is installed in ~/.local/bin/codex and
authenticated via ChatGPT. Run codex --version and codex login status.
Read AGENTS.md before using Codex to edit the repository.

## Read-only Overwatch status

The command pnpm --silent overwatch:status returns one JSON object containing the Git
revision, branch, change count and safe capability flags. It does not reveal
secrets or wallet values and is suitable for authorized status dashboards.

This command does NOT confirm an agent is running. Runtime health remains
not_checked until a separate authorized health probe exists.

## Activation gates

- Building and testing are not equivalent to running a live agent.
- The local shell and Git/skill host-mutation capabilities default to off.
- Real-money actions, wallet transfers, credit top-ups, remote provisioning,
  unattended computer use and outreach require separate approval.
- Do not enable scheduled processes until their scope and stop controls
  have been approved.
- Review the exact diff and complete CI results before merging.
- Treat GitHub Actions timeouts as failures, never as passing tests.
- Upstream contributions are optional, not a development prerequisite.

Independent OS and remote-provider penetration verification remains pending.
