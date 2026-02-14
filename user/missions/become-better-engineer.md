# Become a Better Engineer

Personal growth mission focused on continuous improvement as a software engineer.
Track learning, code quality, knowledge sharing, and deep work habits to
level up consistently over time.

## Mission Parameters

- **Cadence:** Weekly review every Monday morning (`0 9 * * 1`)
- **Scope:** Personal engineering skills, code quality habits, learning, knowledge sharing
- **Stakeholders:** Self, team (indirect)
- **TODO Limits:** 8 active, 30 backlog

## Pillars

### Code Craft
Write cleaner, more maintainable code. Reduce complexity, improve naming,
and consistently apply best practices. The code you write today should be
better than the code you wrote last month.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| PR review feedback ratio | `pr-feedback-ratio` | percentage | < 5% | 10% | down | Weekly from GitHub |
| Average cyclomatic complexity (new code) | `cyclomatic-complexity` | numeric | <= 8 | 12 | down | Weekly via ESLint report |
| Self-review rate (review own PR before requesting) | `self-review-rate` | percentage | >= 95% | 80% | up | Weekly self-assessment |
| Technical debt items addressed | `tech-debt-resolved` | count | >= 2 | 1 | up | Weekly from issue tracker |

**Strategies:**
- Pre-submit self-review checklist — review every PR against a personal quality checklist before requesting review
- Refactor one thing per PR — leave the codebase better than you found it, but keep changes scoped
- Study one design pattern per month — read, implement a small example, apply in real code
- Track and fix recurring review feedback themes

### Learning & Growth
Continuously expand technical knowledge. Stay current with the ecosystem,
deepen expertise in core areas, and explore adjacent domains.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Learning hours per week | `learning-hours` | duration | >= 4h | 2h | up | Weekly self-report |
| Technical articles/papers read | `articles-read` | count | >= 3 | 1 | up | Weekly log |
| New tools/libraries explored | `tools-explored` | count | >= 1 | 0 | up | Monthly log |
| Courses/workshops completed | `courses-completed` | count | >= 1 | 0 | up | Quarterly log |

**Strategies:**
- Dedicated learning block — reserve 1 hour daily for reading, watching talks, or hands-on exploration
- Reading list pipeline — maintain a curated queue of articles, papers, and books; review weekly
- Hands-on experimentation — for every new concept learned, build a small prototype or write a code sample
- Conference talk review — watch at least 2 conference talks per month from top engineering conferences

### Knowledge Sharing
Teaching is the best way to learn. Share what you know through code reviews,
documentation, presentations, and mentoring.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Code reviews given per week | `reviews-given` | count | >= 5 | 3 | up | Weekly from GitHub |
| Internal docs/posts written | `docs-written` | count | >= 1 | 0 | up | Monthly log |
| Mentoring sessions held | `mentoring-sessions` | count | >= 2 | 1 | up | Monthly log |
| Team presentations given | `presentations-given` | count | >= 1 | 0 | up | Quarterly log |

**Strategies:**
- Thorough code reviews — provide substantive, educational feedback on at least 5 PRs per week
- Write one internal doc per month — share a lesson learned, a how-to, or a deep-dive into a system
- Regular mentoring — hold 30-minute 1:1s with junior engineers twice per month
- Quarterly tech talk — present a topic you've learned deeply to the team

### Deep Work Habits
Protect focused time for complex engineering work. Reduce context switching,
improve flow state frequency, and build sustainable productivity habits.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Deep work hours per week | `deep-work-hours` | duration | >= 15h | 10h | up | Weekly from time tracker |
| Longest uninterrupted focus block | `max-focus-block` | duration | >= 2h | 1.5h | up | Weekly from time tracker |
| Meeting load (hours/week) | `meeting-load` | duration | <= 10h | 15h | down | Weekly from calendar |
| Context switches per day (avg) | `context-switches` | count | <= 4 | 6 | down | Weekly self-assessment |

**Strategies:**
- Morning focus block — protect 9am-12pm as meeting-free deep work time
- Batch communications — check Slack/email at scheduled intervals, not continuously
- Meeting audit monthly — decline or shorten meetings that don't require your active participation
- Weekly planning ritual — start each week with a prioritized list of the 3 most important engineering tasks

## Agents

### Mission Lead
- Model: claude-sonnet
- System prompt: See `/user/missions/prompts/better-engineer-lead.md`
- Responsibilities: Weekly review, track habits, suggest improvements, celebrate wins

### Pillar Owners
- **Code Craft**: Default template (researcher-based pillar-owner)
- **Learning & Growth**: Default template (researcher-based pillar-owner)
- **Knowledge Sharing**: Default template (researcher-based pillar-owner)
- **Deep Work Habits**: Default template (researcher-based pillar-owner)

### Workers
- deep-research-team: For researching learning resources, tools, best practices
- writer: For drafting blog posts, documentation, presentation outlines
