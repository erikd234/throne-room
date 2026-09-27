---
title: "Migrations must be ordered against staging"
tags: [lesson, engineering, db]
learned: 2026-09-25
---
Two branches added migrations with the same timestamp prefix; staging applied them out of order.
Check the order against staging before merge.
Now a step in [[playbooks/review-prs]], added by [[people/barbara]].
