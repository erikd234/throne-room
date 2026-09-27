# Parrot Works example pack

A mock company for Throne, taken from the demo video. Parrot Works makes Parrot, a language-learning app with streaks, lessons, a paywall and a TikTok-style feed.

- `company.json`: two bosses (Erik and Bill Land), five areas (Engineering on the parrot, one-app and macbridge repos, plus Support, Marketing, Events and Finance), starting rules, the five automations from the video, and short demo tasks named after the video's workers.
- `brain/`: GBrain pages as markdown. The slug is the path without `.md`. Folders: `people/`, `projects/`, `decisions/`, `lessons/`, `playbooks/` and `reference/`.
- Every page has `title` and `tags` frontmatter. Playbooks also have `steps` (text, source, date), `learned_from` and `updated`. Decisions have `date` and `decided_by`.
- Pages cross-link with `[[folder/slug]]` wikilinks, and every link resolves inside the pack.
- Customers appear only as anonymized archetypes. All numbers are demo data.
