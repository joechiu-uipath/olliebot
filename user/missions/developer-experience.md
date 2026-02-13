# Improve Developer Experience

Our development tools and workflows should continuously improve. Developers should
spend less time fighting tooling and more time shipping features.

## Mission Parameters

- **Cadence:** Continuous — check environment every 4 hours
- **Scope:** Monorepo tooling, CI/CD, local dev setup, documentation
- **Stakeholders:** Engineering team

## Pillars

### Build Performance
Reduce build times and improve caching. Developers should never wait more than
60 seconds for a local dev build.

**Success Metrics:**
- Average local build time < 60s
- CI build time < 5 minutes
- Cache hit rate > 80%

**Strategies:**
- Profile build pipeline quarterly
- Evaluate new bundler releases
- Monitor cache invalidation patterns

### Documentation Currency
Documentation should accurately reflect the current state of the system. Stale
docs are worse than no docs.

**Success Metrics:**
- Zero documented APIs that no longer exist
- All new features documented within 1 week of merge
- README files updated within each package

**Strategies:**
- Weekly doc-drift scan comparing code exports to documented APIs
- PR bot that flags undocumented new exports
- Quarterly full documentation audit

### Onboarding Friction
New team members should be productive within their first week. The onboarding
path should be self-service and continuously validated.

**Success Metrics:**
- Time to first meaningful PR < 3 days
- Setup script success rate > 95%
- Zero manual setup steps not covered by automation

**Strategies:**
- Monthly onboarding dry-run by existing team member
- Track and eliminate every manual step
- Maintain "golden path" automation scripts

## Agents

### Mission Lead
- Model: claude-sonnet
- System prompt: See `/user/missions/prompts/developer-experience-lead.md`
- Responsibilities: Prioritize across pillars, generate TODO items, review completed work, update dashboards

### Pillar Owners
Each pillar can have a dedicated owner agent with domain-specific expertise. If no custom
template is specified, the default `pillar-owner` template (based on the researcher template)
is used.

- **Build Performance**: Custom template — `/user/missions/prompts/build-performance-owner.md`
  - Specializes in bundler performance, build caching, CI/CD optimization, profiling
- **Documentation Currency**: Custom template — `/user/missions/prompts/doc-currency-owner.md`
  - Specializes in doc-drift detection, documentation tooling, automated doc generation
- **Onboarding Friction**: Default template (researcher-based pillar-owner)
  - General-purpose research and analysis for onboarding improvement

### Workers
- deep-research-team: For investigating tools, benchmarking, analyzing trends
- coder: For implementing improvements, writing scripts, modifying configs
- writer: For documentation updates, report generation
