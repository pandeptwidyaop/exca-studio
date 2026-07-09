# Project Hash Routing — Design

**Date:** 2026-07-08
**Status:** Approved

## Problem

The selected project lives only in React state (`currentProject` in `App.tsx`). Refreshing the page loses the selection and falls back to auto-selecting the first project. There is no way to bookmark or return to a specific project.

## Decision Summary

- **URL shape:** hash-based — `/#/project/:id`
- **Root behavior (`/` with no hash):** auto-open the most recent project (current behavior), updating the hash accordingly; show the welcome screen only when the user has no projects
- **Implementation:** `HashRouter` from `react-router-dom` (already a dependency, currently unused)

## Design

### Route structure

- `frontend/src/main.tsx` wraps `<App />` in `<HashRouter>`.
- `App.tsx` remains the layout: it keeps auth state, the projects list, and the sidebar. The main content area becomes `<Routes>`:
  - `/` → `Home` component: if the user has projects, render `<Navigate to={`/project/${first.id}`} replace />`; if not, render the welcome screen (currently inlined in `Canvas.tsx` for the null-project case).
  - `/project/:id` → `CanvasRoute` component: reads `useParams()`, fetches the project fresh from PocketBase (replacing today's `handleSelectProject` refetch logic), renders `<Canvas project={...} />`.

### Data flow changes

- Remove `currentProject` state from `App.tsx`; the URL is the source of truth.
- Sidebar highlight: derive the active project id via `useMatch('/project/:id')`.
- Selecting a project in the sidebar → `navigate('/project/' + id)`.
- Creating a project → after creation, `navigate` to the new project.
- Deleting the active project → `navigate('/', { replace: true })`, which redirects to the next remaining project or the welcome screen.
- Renaming is unaffected (URLs use ids).

### Error handling

- Invalid `:id` or a project not owned by the user (PocketBase returns 404) → redirect to `/` with `replace`; no crash, no error screen.
- Logout with a project hash still in the URL is fine: the Auth screen renders; after logging back in, the project from the hash opens again.

### Out of scope

- Public share links, non-hash (path-based) URLs, and any backend changes. The Go backend needs no modification (hash fragments never reach the server).

## Testing

The frontend has no test infrastructure; verify manually:

1. Open a project, refresh — same project stays open and hash is `#/project/:id`.
2. Browser back/forward navigates between previously opened projects.
3. A bogus id in the hash redirects to the first project (or welcome if none).
4. Deleting the active project lands on the next project (or welcome).
5. Logout then login with a project hash present restores that project.
6. Fresh login at `/` auto-opens the most recent project and updates the hash.
