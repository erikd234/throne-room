---
title: "Sentry"
tags: [reference, engineering, monitoring]
---
Error tracking for backend and app. After each parrot merge, the merger watches it for 10 minutes.
A new top error inside that window means revert first, debug second.
Rule: [[decisions/watch-sentry-after-merge]]. Part of [[playbooks/ship]].
