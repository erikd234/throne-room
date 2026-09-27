---
title: "How we review PRs"
tags: [playbook, engineering]
steps:
  - text: "Run the tests; read every line of the diff"
    source: "learned from 146 reviews"
    date: 2026-09-01
  - text: "Check the HEX-2 and HEX-9 architecture gates"
    source: "from Ada · 22 Sep"
    date: 2026-09-22
  - text: "UI change? Screenshots in both themes"
    source: "from Erik's send-backs"
    date: 2026-09-16
  - text: "Migrations: check order against staging"
    source: "from Barbara · 25 Sep"
    date: 2026-09-25
  - text: "Flaky test? Rerun once, then file it"
    source: "from Ken · 19 Sep"
    date: 2026-09-19
learned_from: "146 PRs"
updated: 2026-09-27
---
Used by 9 workers across [[projects/parrot]] and one-app.
Gates: [[reference/hex-gates]]. Themes: [[lessons/screenshots-both-themes]].
Migrations: [[lessons/migration-order-vs-staging]]. Flakes: [[decisions/flaky-test-rerun-once]].
