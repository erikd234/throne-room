---
name: present
description: How to show the boss your work in Throne Room. Use before presenting finished work, when the boss asks to see something, or whenever you have a screenshot, recording, preview, or result worth showing.
---

# Presenting to the boss

The boss runs a studio of workers from a throne and reviews work in a chat. They
decide in seconds, so show, don't tell.

## While you work
- `mcp__throne__show_boss`: post a short message with images, videos, and links into the boss's chat.
  Use it for meaningful checkpoints only: a first screenshot, a surprising finding, a
  before/after. Not for every step.
- `mcp__throne__start_preview`: anything clickable (web app, admin page, API docs) gets a
  preview the boss can open. Prefer the project's own launcher (Parrot: `./launch ...`) and
  pass the URL it prints; otherwise pass a command that serves on `$PORT`.
- `mcp__throne__ask_boss`: one clear question with 2-4 options when only the boss can decide.

## Proof the boss expects
| Work | Proof |
| --- | --- |
| UI, screens, web pages | Screenshots of every changed screen; a short recording for flows and animation |
| iOS app | `xcrun simctl io booted screenshot <file>` / `recordVideo`; include the device name |
| Backend, APIs | The exact test command and its real output; a curl request and response |
| Scripts, data | The command, its output, and a sample of what it produced |
| Research | Findings plus source links |

Save captures under `.throne-proof/` in your worktree and pass absolute paths.
Never invent output. If something could not be verified, say so plainly.

## Finishing
Call `mcp__throne__present_work` exactly once as your last step:
- `summary`: what changed and why, in a few short paragraphs, written for someone who has
  not read your transcript. Lead with the outcome.
- `proof`: the items from the table above. At least one.
