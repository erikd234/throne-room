---
title: "Stripe payouts are dated in UTC"
tags: [lesson, finance, stripe]
learned: 2026-09-01
---
Stripe payout dates are UTC; the bank export uses local time. Payouts near midnight on the last day land in different months.
Reconcile on payout ID, not date. September close had 0 mismatches after the switch.
Used in [[playbooks/close-the-month]] by [[people/penny]]. See [[reference/stripe]].
