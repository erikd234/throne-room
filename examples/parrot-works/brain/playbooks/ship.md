---
title: "How we ship"
tags: [playbook, engineering, release]
steps:
  - text: "Proof attached: screenshots or real test output"
    source: "learned from 38 releases"
    date: 2026-09-05
  - text: "CI green, then the merge yard"
    source: "from Joan · 20 Sep"
    date: 2026-09-20
  - text: "Parrot merges deploy to prod: watch Sentry for 10 min"
    source: "from an incident · 14 Sep"
    date: 2026-09-14
  - text: "Post every stage to #releases"
    source: "decided by Erik · 25 Sep"
    date: 2026-09-25
  - text: "Marketing sends the launch email"
    source: "from Maya · 27 Sep"
    date: 2026-09-27
learned_from: "38 releases"
updated: 2026-09-27
---
Used by 11 workers. Merging to main deploys backend and web and fast-forwards TestFlight.
Yard: [[reference/merge-yard]]. Sentry: [[decisions/watch-sentry-after-merge]].
Email: [[playbooks/write-launch-emails]].
