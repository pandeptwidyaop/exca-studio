# Project Search in Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search input in the sidebar filters the project list by name via a debounced server-side PocketBase query.

**Architecture:** Search state lives entirely in `Sidebar.tsx` via a new `useProjectSearch` hook; `App.projects` stays the unfiltered master list (Home's `/` redirect and welcome check depend on it). Empty query renders the `projects` prop unchanged; non-empty query renders results fetched with `pb.filter('name ~ {:q}')` after a 300 ms debounce.

**Tech Stack:** React 19, TypeScript, PocketBase JS SDK (`pb.filter`, `getFullList`), TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-07-09-project-search-design.md`

## Global Constraints

- Server-side search: `pb.collection('projects').getFullList({ sort: '-created', filter: pb.filter('name ~ {:q}', { q: query }) })` — NEVER build the filter with template strings (injection into filter syntax).
- Debounce is exactly 300 ms.
- No `user =` clause in the filter: PocketBase collection rules already scope results to the requesting user.
- `App.projects` must remain unfiltered; search state must not leave `Sidebar`.
- While a search response is pending, the previously displayed list stays visible (no spinner). "No projects found" appears only for a non-empty query whose response arrived with zero results.
- No new npm dependencies. No backend (Go) changes.
- No test framework — gates are `npm run build` and `npm run lint` from `/Users/pande/Works/exca-studio/frontend/`. Lint baseline: `main` already has 7 pre-existing problems (6 `no-explicit-any` errors + 1 warning in Auth.tsx/Canvas.tsx/types.ts); the requirement is ZERO NEW problems, not exit 0. Beware `react-hooks/set-state-in-effect`: do not call setState synchronously in an effect body (async callbacks like `.then` are fine).
- Existing style: default-exported function components, Tailwind classes, `as unknown as Project` casts for PocketBase records, `console.error` in catch blocks.

---

### Task 1: useProjectSearch hook

**Files:**
- Create: `frontend/src/hooks/useProjectSearch.ts` (new `hooks/` directory)

**Interfaces:**
- Consumes: `pb` from `../lib/pocketbase`, `Project` from `../types`.
- Produces: `useProjectSearch` — default export, no arguments, returns `{ query: string; setQuery: (q: string) => void; results: Project[] | null; refresh: () => void }`. `results` is `null` until the first response for a non-empty query lands (and is NOT reset when the query changes — consumers decide what to show while pending). `refresh()` re-runs the fetch with the current query (no-op when the query is blank). Used by `Sidebar.tsx` in Task 2.

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useProjectSearch.ts` with exactly:

```ts
import { useState, useEffect } from 'react';
import pb from '../lib/pocketbase';
import type { Project } from '../types';

// Server-side project search: debounced 300ms, results scoped to the
// requesting user by PocketBase collection rules.
export default function useProjectSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Project[] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!query.trim()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      pb.collection('projects')
        .getFullList({
          sort: '-created',
          filter: pb.filter('name ~ {:q}', { q: query }),
        })
        .then((records) => {
          if (!cancelled) {
            setResults(records as unknown as Project[]);
          }
        })
        .catch((err) => {
          console.error('Failed to search projects:', err);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, refreshTick]);

  const refresh = () => setRefreshTick((t) => t + 1);

  return { query, setQuery, results, refresh };
}
```

Notes for the implementer:
- The effect cleanup both cancels the debounce timer and flags in-flight responses as stale, so out-of-order responses can never apply (spec's `cancelled`-style guard).
- There is deliberately no `setResults(null)` in the effect body: it would hit the `react-hooks/set-state-in-effect` lint error, and the spec wants the previous list visible while a new response is pending anyway.
- An errored fetch leaves `results` untouched (spec: display unchanged, `console.error` only).

- [ ] **Step 2: Verify build passes**

Run from `frontend/`: `npm run build`
Expected: exit 0. (The hook is not imported yet; unused files do not fail the build.)

- [ ] **Step 3: Verify no new lint problems**

Run from `frontend/`: `npm run lint`
Expected: exactly the 7 pre-existing problems (Auth.tsx, Canvas.tsx, types.ts); nothing reported for `hooks/useProjectSearch.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useProjectSearch.ts
git commit -m "feat: add useProjectSearch hook (debounced PocketBase name search)"
```

---

### Task 2: Wire search into Sidebar

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (5 edits below)

**Interfaces:**
- Consumes: `useProjectSearch` from `../hooks/useProjectSearch` (Task 1: returns `{ query, setQuery, results, refresh }`).
- Produces: no interface changes — `SidebarProps` stays exactly as is; App.tsx is untouched.

- [ ] **Step 1: Import and instantiate the hook**

**1a** — add the import after the existing `pb` import (`import pb from '../lib/pocketbase';`):

```tsx
import useProjectSearch from '../hooks/useProjectSearch';
```

**1b** — inside the `Sidebar` function, after the existing `useState` declarations (the last one is `const [contextMenuId, setContextMenuId] = useState<string | null>(null);`), add:

```tsx
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    refresh: refreshSearch,
  } = useProjectSearch();

  const isSearching = searchQuery.trim() !== '';
  // While the first response is pending (results null), keep showing the full list
  const visibleProjects = isSearching ? (searchResults ?? projects) : projects;
```

- [ ] **Step 2: Refresh search results after rename and delete**

In `handleRename`, directly after the existing `onRenamed();` line, add:

```tsx
      refreshSearch();
```

In `handleDelete`, directly after the existing `onDeleted(projectId);` line, add:

```tsx
      refreshSearch();
```

(`refreshSearch` is a no-op while the query is blank — the hook's effect returns early.)

- [ ] **Step 3: Add the search input**

In the Projects List section, directly after the `<div className="flex items-center justify-between mb-3">...</div>` block that contains the "Projects" heading and the `+` button (and BEFORE the `{isCreating && (` new-project form), add:

```tsx
          {/* Search */}
          <div className="relative mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="w-full px-2 py-1 pr-7 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-gray-400 hover:text-white text-sm"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
```

- [ ] **Step 4: Render visibleProjects and the two empty states**

**4a** — change the list mapping line:

```tsx
            {projects.map((project) => (
```

to:

```tsx
            {visibleProjects.map((project) => (
```

**4b** — replace the existing empty-state block:

```tsx
          {projects.length === 0 && !isCreating && (
            <p className="text-gray-500 text-sm text-center mt-4">
              No projects yet. Create one!
            </p>
          )}
```

with:

```tsx
          {isSearching && searchResults && searchResults.length === 0 && (
            <p className="text-gray-500 text-sm text-center mt-4">
              No projects found
            </p>
          )}

          {!isSearching && projects.length === 0 && !isCreating && (
            <p className="text-gray-500 text-sm text-center mt-4">
              No projects yet. Create one!
            </p>
          )}
```

Everything else in the file (create form, context menu, rename form, delete modal, highlight via `currentProjectId`) stays untouched — search results are `Project` records, so all existing per-item actions work on them as-is.

- [ ] **Step 5: Verify build and lint**

Run from `frontend/`:

```bash
npm run build
npm run lint
```

Expected: build exit 0; lint reports exactly the 7 pre-existing problems, nothing new for Sidebar.tsx.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat: add project search input to sidebar"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Terminal 1: `cd backend && go run main.go serve --http=127.0.0.1:8092`
Terminal 2: `cd frontend && npm run dev`
Open http://localhost:5173 and log in (test user `test@example.com` / `test12345` exists from the previous feature's verification; create a few projects with distinct names if the list is empty).

- [ ] **Step 2: Run the spec checklist**

1. Type a partial project name with different casing → matching projects appear (case-insensitive contains).
2. Clear the query with backspace and again via the ✕ button → full list returns instantly (no request).
3. Rename a project from search results → rename works, results refresh with the query kept.
4. Delete a non-active project from search results → it disappears from results and the full list.
5. Delete the ACTIVE project from search results → lands on the next project (or welcome) per existing routing.
6. Query with no matches → "No projects found".
7. Active project stays highlighted inside search results.
8. Type rapidly ("a", then quickly "ab", "abc") → final results match the final query only.

Expected: all 8 pass. If any fail, fix before proceeding (systematic-debugging skill).
