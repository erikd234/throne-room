---
title: "Automations"
tags: [reference, qm, automation]
---
QM crons, watches and webhooks that hand a ticket to a worker in an area.
- Monthly close, 1st at 09:00 → Finance: [[playbooks/close-the-month]]
- Support digest, Mondays 08:00 → Support
- Stripe payout failed webhook → Support: [[playbooks/handle-payout-failures]]
- Flaky test sweep, nightly 02:00 → Engineering
- App Store review under 3 stars → Marketing: [[playbooks/triage-app-store-reviews]]
Runtime: [[projects/qm]].
