# Multi-User Collaboration — Design

**Date:** 2026-07-28
**Status:** Approved

## Problem

Projects are strictly single-user: collection rules allow only the owner to see or edit a project, and there is no mechanism for two people (or two tabs) to work on the same canvas. Concurrent edits silently overwrite each other (last-write-wins on the whole scene).

## Decision Summary

- **Access model:** owner invites registered users by email; roles **editor** and **viewer**
- **Realtime:** live sync over a WebSocket endpoint **embedded in the existing Go/PocketBase binary**
- **Sync protocol:** element-level deltas merged with Excalidraw's `reconcileElements` (exported by `@excalidraw/excalidraw` 0.18)
- **Presence:** live cursors with names + online-users avatar list
- **Persistence:** the server (room) owns scene persistence while a collab session is active; client autosave becomes a disconnected-only fallback
- **Sidebar:** separate "Shared with me" section
- **Scope:** one spec/branch covering membership + realtime (user's explicit choice over phasing)

## 1. Data Model & Rules (PocketBase)

New migration adds two multi-relation fields to `projects`, both relating to `users`:

- `editors` — members who can draw
- `viewers` — members who can only watch (live)

No join collection: with exactly two roles, two relation fields are simpler to query and to guard in rules.

Rules change to:

| Rule | Value |
|---|---|
| List/View | `user.id = @request.auth.id \|\| editors.id ?= @request.auth.id \|\| viewers.id ?= @request.auth.id` |
| Update | owner: unrestricted; editor: `scene` only, enforced with `@request.data.<field>:isset = false` guards for `name`, `user`, `editors`, `viewers` |
| Create | unchanged (`@request.auth.id != ''`); `user` must be the requester |
| Delete | unchanged (owner only) |

### Membership endpoints (custom Go routes)

The `users` collection stays locked (no relaxed ViewRule, no user search from the frontend). Membership is managed via authenticated custom endpoints, all **owner-only**:

- `POST /api/collab/projects/{id}/members` — body `{email, role}` (`role` ∈ `editor|viewer`); finds the user by email, adds them to the matching relation field. Errors: email not registered, already a member (in either role), inviting yourself.
- `DELETE /api/collab/projects/{id}/members/{userId}` — removes from whichever role field contains them.
- `GET /api/collab/projects/{id}/members` — returns `[{id, name, email, role}]` for the share dialog (server-side read of user records, so `users` rules stay untouched).

## 2. Backend — WebSocket Hub

**Route:** `GET /ws/collab/{projectId}?token=<pb auth token>` — token in query string because browsers cannot set WS headers. Upgrade via `gorilla/websocket` (the only new Go dependency).

**On connect:** validate token → load auth record → resolve role: owner/`editors` → *editor*, `viewers` → *viewer*, otherwise close (auth/permission close codes). Client joins the project's **Room**.

**Room** (in-memory, one per project with ≥1 client):

- client list with user identity + role
- authoritative scene snapshot: elements map keyed by element id (each with Excalidraw's `version`/`versionNonce`) + `files` object
- loaded from the DB `scene` on first join; deltas applied on arrival (higher version wins, matching client-side reconciliation)

**Messages (JSON):**

| Direction | Type | Payload / behavior |
|---|---|---|
| server→client | `init` | full snapshot (elements + files) + current online users; sent on join and after reconnect |
| client→server | `scene-update` | changed elements only; **rejected for viewers**; applied to snapshot then relayed to other clients |
| client→server | `files-added` | new image files; **rejected for viewers**; merged into snapshot, relayed |
| client→server | `pointer` | cursor position; relayed, never stored; allowed for viewers |
| server→client | `user-joined` / `user-left` | presence roster updates |
| server→client | `session-closed` | reason code: `removed` (membership revoked) or `deleted` (project deleted); server then closes the socket |

Read-only is enforced **server-side** (viewer `scene-update` dropped), not just in the UI.

**Persistence:** the room saves the snapshot to `projects.scene` (server-side DAO write, bypassing collection rules) debounced ~5 s while dirty, plus a final save when the last client disconnects (room is then torn down). While a client's socket is connected, that client does **not** write `scene` via the REST API; the existing 2 s debounced autosave remains only as a fallback while disconnected. Deleted elements (`isDeleted: true`) are kept in the snapshot as Excalidraw expects; no pruning in v1.

**Membership changes / deletion mid-session:** the invite/remove/delete code paths notify the hub; affected clients receive `session-closed` and are disconnected. Role changes take effect on next connect (v1 keeps it simple: remove + re-invite).

## 3. Frontend — Collab Client & Canvas

New module `frontend/src/lib/collab.ts` — a `CollabClient` class (analogous to excalidraw.com's Portal):

- **Connection:** connect on canvas mount for any project the user can open; reconnect with exponential backoff; expose connection state to the UI.
- **Outgoing:** on Excalidraw `onChange`, send only elements whose `version` is newer than the last broadcast for that element id (tracked in a `Map<id, version>`), throttled at ~100 ms. `onPointerUpdate` → `pointer` messages, throttled at ~50 ms.
- **Incoming:** `scene-update`/`init` → `reconcileElements(local, remote, appState)` → `excalidrawAPI.updateScene(...)`. Concurrent edits to different elements both survive; same element resolves deterministically by highest version.
- **Presence:** maintain a `collaborators` Map (`{username, color, pointer}`) fed by `pointer`/`user-joined`/`user-left`, pushed via `updateScene({ collaborators })` — Excalidraw renders remote cursors + name labels natively. User color derived deterministically from a hash of the userId.

**Canvas integration:**

- viewer role → `viewModeEnabled` prop (server rejection is the second layer)
- online-users avatar stack (initials, user colors) rendered via Excalidraw's `renderTopRightUI` prop
- while the socket is open, the debounced REST autosave is suspended; it resumes when disconnected

## 4. Sharing UI & Sidebar

- **Sidebar:** two groups — "Projects" (own) and **"Shared with me"** (rendered only when non-empty). `App` fetches every project visible under the new rules in one request and splits client-side by `user === myId`. `Home` (`/`) redirects to the most recent **own** project; if the user owns none but has shared projects, it redirects to the most recent shared one; the welcome screen appears only when both groups are empty. Rename/delete/share actions are hidden on shared items; project search covers both groups.
- **Share dialog:** owner-only "Share" action on a project item → modal listing current members with their role, remove buttons, and an invite form (email + role select). Backed by the three membership endpoints. Errors (unregistered email, duplicate member) render inline in the modal.

## 5. Error Handling

- **WS drop:** exponential-backoff reconnect. While disconnected, editors fall back to direct REST autosave. On reconnect the server sends `init`; the client reconciles, so offline edits merge back (highest element version wins) and are then re-broadcast.
- **Removed mid-session:** `session-closed` (`removed`) → notice to the user, redirect to `/`.
- **Project deleted mid-session:** `session-closed` (`deleted`) → existing CanvasRoute 404→redirect path handles the fallout for late requests.
- **Invite failures:** inline error messages in the share modal (email not found, already a member).
- **Save failures (server):** logged; retried on the next debounce tick; final-save failure logged loudly.

## 6. Testing

No automated test framework. Gates: `npm run build` (exit 0), `npm run lint` (zero NEW problems beyond the 7-problem baseline), `go build` + `go vet`.

Manual verification with two browsers / two accounts:

1. Owner invites user B as editor by email → project appears in B's "Shared with me".
2. Both draw simultaneously on different elements → both edits survive on both screens (~instant).
3. Both move the same element → one deterministic winner, no flicker loop.
4. Live cursors with names visible both ways; avatar stack shows both users.
5. B as viewer: canvas is view-only; server drops any forged updates; B's cursor still visible to the owner.
6. Kill B's network → B edits offline (autosave fallback) → reconnect → edits merge and broadcast.
7. Owner removes B mid-session → B gets notified and lands on `/`.
8. Everyone disconnects → reopen project → last state persisted correctly.
9. Owner deletes the project while B is in it → B lands on `/` (or welcome).
10. Search finds shared projects; rename/delete/share hidden on them for B.

## Out of Scope

Share links, E2E encryption, comments/chat, ownership transfer, cross-user undo/redo, notifications, role editing in place (remove + re-invite instead), offline CRDT.
