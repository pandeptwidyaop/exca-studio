# Project Search in Sidebar — Design

**Date:** 2026-07-09
**Status:** Approved

## Problem

The sidebar lists all projects with no way to find one by name. Users with many projects must scan the whole list.

## Decision Summary

- **Mechanism:** server-side search via PocketBase (`name ~ query`), debounced 300 ms
- **State ownership:** the search query and its results live in `Sidebar.tsx`; `App.projects` stays the unfiltered master list
- **Placement:** always-visible input below the "Projects" header, above the create form

## Design

### State ownership

`Sidebar` keeps two new pieces of state: `searchQuery` (string) and `searchResults` (`Project[] | null`).

- Empty query → render the `projects` prop (today's behavior, no request).
- Non-empty query → render `searchResults` from the PocketBase fetch.

`App.projects` is deliberately left unfiltered: `Home` uses it for the `/` redirect and the zero-projects welcome check. If search results replaced `App.projects`, an empty search could make `Home` show the welcome screen to a user who has projects, or redirect to the wrong project after a delete. Sidebar-local state prevents that class of bug.

### PocketBase query

On each keystroke, debounce 300 ms, then:

```ts
pb.collection('projects').getFullList({
  sort: '-created',
  filter: pb.filter('name ~ {:q}', { q: query.trim() }),
})
```

- `pb.filter()` escapes the user input safely (never build the filter with template strings).
- `~` is case-insensitive contains.
- No `user =` clause: PocketBase collection rules already restrict results to the requesting user's projects.
- Out-of-order responses are ignored: a result is applied only if its query still matches the current input (same `cancelled`-style guard used in `CanvasRoute`).

### Behavior

- Search results are regular list items: click navigates, and the existing rename/delete/context-menu actions work on them.
- After a rename or delete while a search is active, the search re-runs with the same query (in addition to the existing `onRenamed`/`onDeleted` master-list reload).
- Creating a project clears the search query, so the new project is immediately visible and highlighted (added during final review).
- Clearing the query (typing it empty or clicking the ✕ button in the input) returns to the full list without a request.
- Non-empty query with zero results → "No projects found" text in place of the list.
- No loading spinner: results arrive fast on a local network; the previous list stays visible until new results land.
- Active-project highlight (`currentProjectId`) works the same in search results.

### Error handling

A failed search fetch logs `console.error` and leaves the currently displayed list unchanged, consistent with existing error handling.

### Out of scope

- Pagination, fuzzy matching, search across scene contents, keyboard navigation of results, backend changes.

## Testing

No test infrastructure; verify manually:

1. Type a partial project name with different casing → matching projects appear.
2. Clear the query (backspace and via ✕) → full list returns.
3. Rename and delete a project from search results → action works and results refresh with the query kept.
4. Delete the active project from search results → lands on the next project (or welcome) per existing routing behavior.
5. Query with no matches → "No projects found".
6. Active project stays highlighted inside search results.
7. Type rapidly (e.g. "abc" then quickly "abcd") → final results match the final query.
