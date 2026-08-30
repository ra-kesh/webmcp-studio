# LIBRARY-02 Gate 4B independent review

Date: 2026-08-31

Status: accepted; zero open P0/P1 findings

## Scope

The reviewer read the production cutover code for the shared Start/editor
template browser, discovery-provider lease ownership, exact create/apply
actions, legacy-path removal, responsive presentation, virtualization, focus,
announcements and recoverable states. The review used the Gate 4 phase contract
and current Studio code rather than screenshots alone.

## Findings closed

- The runtime and CSS desktop boundaries diverged between 1,032 px and 1,279 px,
  allowing duplicate surface ownership. Both now use one 1,280 px presentation
  boundary and a single visibility resolver.
- A hidden browser still mounted discovery and detail work. Hidden surfaces now
  hold only an inactive lease and do not subscribe or resolve items.
- Controller announcements could mask persistent action failures. The live
  message now preserves distinct failures alongside changing result status.
- An empty catalog and a filtered no-result set used the same recovery. They now
  have distinct explanations, and Show all templates resets every active
  criterion before returning focus to results.
- Focus could be lost when a result disappeared or a virtual row remounted, then
  later stolen from Favorite or overflow actions. The browser now separates
  explicit focus intent from standing card identity, restores only after actual
  focus loss and leaves an already focused descendant untouched.

## Evidence

- Independent final review: zero P0 and zero P1.
- Reviewer focused run: 6 files / 32 tests passed.
- Additional focused browser and virtualization run after the final focus repair:
  2 files / 15 tests passed.
- Studio TypeScript check passed.
- `git diff --check` passed.

## Non-blocking follow-up

Start currently projects the same template action failure into both the global
document alert and the contextual template browser error. The action remains
recoverable and correctly owned, so this is a P2 announcement/polish issue. It
must be deduplicated during the next bounded visual/accessibility polish pass.
