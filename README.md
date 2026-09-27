# Throne Room

Sit on a throne in an isometric office. Hire workers; each one is a real Claude
Agent SDK session in its own git worktree. They come back up the carpet to ask
questions, present proof, and get their PRs merged.

```bash
claude /login        # once: workers use your Claude Code login
npm install
npm start            # http://localhost:4777
```

- **Hire (H):** pick a role, a repo, and a task. The worker gets a sibling worktree
  (`<repo>-throne-<name>-<id>`) on a `throne/...` branch from `origin/HEAD`.
- **Autonomy:** sessions bypass permission prompts inside their worktree, but
  `git push`, `gh pr create/merge`, and releases are denied. Publishing only happens
  from the throne.
- **Proof:** workers finish by calling `present_work` with screenshots, recordings,
  or real test output. Media is copied to `~/.throne-room/proof/` and shown in the
  review. No proof shows up as a red "No proof" tag.
- **The line (Space):** questions (`ask_boss`), finished work, green PRs to merge,
  and CI failures. "Merge all green" merges every passing PR after a confirm.
- **The brain (B):** teach a rule and every worker follows it, including sessions
  already running. Notes and answers can be taught with one checkbox. If `gbrain`
  is on your PATH, workers also share GBrain long-term memory over MCP.

State lives in `~/.throne-room/state.json` (`THRONE_HOME` to change). `PORT` sets the port.
