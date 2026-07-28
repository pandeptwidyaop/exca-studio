# Multi-User Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners invite users by email as editor/viewer; everyone in a project collaborates live (element-level sync, cursors, presence) over a WebSocket embedded in the Go binary.

**Architecture:** A new Go package `backend/collab` hosts an in-memory Hub of per-project Rooms behind `GET /ws/collab/:projectId`; rooms merge element deltas (higher `version` wins), relay to peers, and own persistence (debounced 5 s + final save). Frontend gets a `CollabClient` (`frontend/src/lib/collab.ts`) wired into `Canvas.tsx`; membership is two new relation fields (`editors`, `viewers`) on `projects` plus three custom owner-only endpoints.

**Tech Stack:** Go + PocketBase 0.22.25 (echo v5), `gorilla/websocket`, React 19 + TypeScript, `@excalidraw/excalidraw` 0.18 (`reconcileElements`, `restoreElements`, `CaptureUpdateAction`), PocketBase JS SDK (`pb.send`).

**Spec:** `docs/superpowers/specs/2026-07-28-collaboration-design.md`

## Global Constraints

- Lint baseline: `main` has exactly 7 pre-existing problems (6 `no-explicit-any` errors + 1 warning in Auth.tsx/Canvas.tsx/types.ts). Gate = ZERO NEW problems, not exit 0. **Never write a new literal `any` annotation** — use structural types or `as unknown as X` casts. When editing Canvas.tsx keep the existing `any` annotations exactly as they are (rewriting the same tokens keeps the baseline count).
- `react-hooks/set-state-in-effect` is enforced: never call setState synchronously in an effect body (async/event callbacks are fine).
- Frontend gates (run from `frontend/`): `npm run build` exit 0; `npm run lint` zero new problems.
- Backend gates (run from `backend/`): `go build ./...`, `go vet ./...`, `go test ./...` all exit 0.
- Only new dependency allowed: `github.com/gorilla/websocket` (Go). No new npm dependencies.
- Go module name is `excalidraw-studio-backend` — internal imports are `excalidraw-studio-backend/collab`.
- PocketBase 0.22 APIs: `app.Dao()`, `apis.RequireRecordAuth("users")`, `c.Get(apis.ContextAuthRecordKey)`, `c.PathParam(...)`, echo v5 (`github.com/labstack/echo/v5`).
- Roles: owner and `editors` members are `"editor"`; `viewers` members are `"viewer"`. Read-only is enforced server-side (viewer `scene-update`/`files-added` dropped).
- Existing style: default-exported function components, Tailwind classes, `as unknown as Project` casts, `console.error` in catch blocks.
- Do not commit `frontend/package-lock.json` changes (there must be none) or `backend/pb_data/`.

---

### Task 1: Migration — collab fields + rules

**Files:**
- Create: `backend/migrations/1753660800_collab_members.go`

**Interfaces:**
- Produces: `projects` collection gains multi-relation fields `editors` and `viewers` (→ users); List/View/Update rules opened per spec. Tasks 2-8 rely on these field names exactly.

- [ ] **Step 1: Write the migration**

Create `backend/migrations/1753660800_collab_members.go` with exactly:

```go
package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		for _, name := range []string{"editors", "viewers"} {
			collection.Schema.AddField(&schema.SchemaField{
				Name: name,
				Type: schema.FieldTypeRelation,
				Options: &schema.RelationOptions{
					CollectionId:  "_pb_users_auth_",
					CascadeDelete: false,
					MaxSelect:     nil, // multiple
				},
			})
		}

		memberVisible := "@request.auth.id = user.id || editors.id ?= @request.auth.id || viewers.id ?= @request.auth.id"
		// Owner: unrestricted. Editor: may only touch `scene`.
		editorSceneOnly := "@request.auth.id = user.id || (editors.id ?= @request.auth.id && @request.data.name:isset = false && @request.data.user:isset = false && @request.data.editors:isset = false && @request.data.viewers:isset = false)"

		listRule := memberVisible
		viewRule := memberVisible
		updateRule := editorSceneOnly
		collection.ListRule = &listRule
		collection.ViewRule = &viewRule
		collection.UpdateRule = &updateRule

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		for _, name := range []string{"editors", "viewers"} {
			if f := collection.Schema.GetFieldByName(name); f != nil {
				collection.Schema.RemoveField(f.Id)
			}
		}

		ownerOnly := "@request.auth.id = user.id"
		listRule := ownerOnly
		viewRule := ownerOnly
		updateRule := ownerOnly
		collection.ListRule = &listRule
		collection.ViewRule = &viewRule
		collection.UpdateRule = &updateRule

		return dao.SaveCollection(collection)
	})
}
```

- [ ] **Step 2: Verify build**

Run from `backend/`: `go build ./... && go vet ./...`
Expected: exit 0.

- [ ] **Step 3: Verify migration applies**

Run from `backend/`: `go run main.go migrate up` (automigrate also applies on serve). Expected output includes `Applied 1753660800_collab_members.go`. Then `go run main.go migrate down 1` + `go run main.go migrate up` to prove the down migration works, ending in the applied state.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/1753660800_collab_members.go
git commit -m "feat: add editors/viewers fields and member-visible rules to projects"
```

---

### Task 2: collab package core — messages, room, hub (+ unit tests)

**Files:**
- Create: `backend/collab/messages.go`
- Create: `backend/collab/room.go`
- Create: `backend/collab/hub.go`
- Test: `backend/collab/room_test.go`

**Interfaces:**
- Produces (used by Tasks 3-4):
  - `type Message struct { Type string; Elements []json.RawMessage; Files map[string]json.RawMessage; Pointer json.RawMessage; User *UserInfo; Users []UserInfo; Reason string }` (all json-tagged, omitempty)
  - `type UserInfo struct { ID, Name, Role string }`
  - `type SceneStore interface { LoadScene(projectID string) ([]byte, error); SaveScene(projectID string, scene []byte) error }`
  - `type RoomClient interface { Send(msg Message); User() UserInfo; CanEdit() bool; CloseSoon() }`
  - `Room` methods: `ApplyUpdate(from RoomClient, elements []json.RawMessage)`, `ApplyFiles(from RoomClient, files map[string]json.RawMessage)`, `RelayPointer(from RoomClient, pointer json.RawMessage)`
  - `Hub`: `NewHub(store SceneStore) *Hub`, `(h *Hub) Join(projectID string, c RoomClient) (*Room, error)`, `(h *Hub) Leave(projectID string, room *Room, c RoomClient)`, `(h *Hub) KickUser(projectID, userID, reason string)`, `(h *Hub) CloseProject(projectID, reason string)`

- [ ] **Step 1: Create `backend/collab/messages.go`**

```go
package collab

import "encoding/json"

// Message is the wire format for /ws/collab, both directions.
// Types: init, scene-update, files-added, pointer, user-joined,
// user-left, session-closed.
type Message struct {
	Type     string                     `json:"type"`
	Elements []json.RawMessage          `json:"elements,omitempty"`
	Files    map[string]json.RawMessage `json:"files,omitempty"`
	Pointer  json.RawMessage            `json:"pointer,omitempty"`
	User     *UserInfo                  `json:"user,omitempty"`
	Users    []UserInfo                 `json:"users,omitempty"`
	Reason   string                     `json:"reason,omitempty"`
}

// UserInfo identifies a collaborator. Role is "editor" or "viewer".
type UserInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

// elementMeta is the subset of an Excalidraw element the server reads.
// Index is Excalidraw's fractional index — lexicographic order == z-order.
type elementMeta struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
	Index   string `json:"index"`
}

func ptr[T any](v T) *T { return &v }
```

- [ ] **Step 2: Write failing tests `backend/collab/room_test.go`**

```go
package collab

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

type fakeStore struct {
	mu     sync.Mutex
	scene  []byte
	saved  [][]byte
	failed bool
}

func (s *fakeStore) LoadScene(projectID string) ([]byte, error) {
	if s.failed {
		return nil, fmt.Errorf("load failed")
	}
	return s.scene, nil
}

func (s *fakeStore) SaveScene(projectID string, scene []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saved = append(s.saved, scene)
	return nil
}

func (s *fakeStore) lastSaved() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.saved) == 0 {
		return nil
	}
	return s.saved[len(s.saved)-1]
}

type fakeClient struct {
	mu   sync.Mutex
	user UserInfo
	got  []Message
}

func (c *fakeClient) Send(msg Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.got = append(c.got, msg)
}
func (c *fakeClient) User() UserInfo { return c.user }
func (c *fakeClient) CanEdit() bool  { return c.user.Role == "editor" }
func (c *fakeClient) CloseSoon()     {}

func (c *fakeClient) messages() []Message {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]Message(nil), c.got...)
}

func el(id string, version int64, index string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"id":%q,"version":%d,"index":%q}`, id, version, index))
}

func joinTwo(t *testing.T, store *fakeStore) (*Hub, *Room, *fakeClient, *fakeClient) {
	t.Helper()
	hub := NewHub(store)
	a := &fakeClient{user: UserInfo{ID: "ua", Name: "A", Role: "editor"}}
	b := &fakeClient{user: UserInfo{ID: "ub", Name: "B", Role: "editor"}}
	room, err := hub.Join("p1", a)
	if err != nil {
		t.Fatalf("join a: %v", err)
	}
	if _, err := hub.Join("p1", b); err != nil {
		t.Fatalf("join b: %v", err)
	}
	return hub, room, a, b
}

func TestHigherVersionWinsAndRelays(t *testing.T) {
	store := &fakeStore{scene: []byte(`{"elements":[{"id":"e1","version":3,"index":"a1"}],"appState":{},"files":{}}`)}
	_, room, a, b := joinTwo(t, store)

	room.ApplyUpdate(a, []json.RawMessage{el("e1", 5, "a1")})

	found := false
	for _, m := range b.messages() {
		if m.Type == "scene-update" && len(m.Elements) == 1 {
			found = true
		}
	}
	if !found {
		t.Fatal("expected b to receive relayed scene-update")
	}
	for _, m := range a.messages() {
		if m.Type == "scene-update" {
			t.Fatal("sender must not receive its own update")
		}
	}
}

func TestLowerVersionIgnored(t *testing.T) {
	store := &fakeStore{scene: []byte(`{"elements":[{"id":"e1","version":3,"index":"a1"}],"appState":{},"files":{}}`)}
	_, room, a, b := joinTwo(t, store)

	room.ApplyUpdate(a, []json.RawMessage{el("e1", 2, "a1")})

	for _, m := range b.messages() {
		if m.Type == "scene-update" {
			t.Fatal("stale update must not be relayed")
		}
	}
}

func TestInitSnapshotSent(t *testing.T) {
	store := &fakeStore{scene: []byte(`{"elements":[{"id":"e1","version":3,"index":"a1"}],"appState":{},"files":{}}`)}
	hub := NewHub(store)
	a := &fakeClient{user: UserInfo{ID: "ua", Name: "A", Role: "editor"}}
	if _, err := hub.Join("p1", a); err != nil {
		t.Fatalf("join: %v", err)
	}
	msgs := a.messages()
	if len(msgs) == 0 || msgs[0].Type != "init" || len(msgs[0].Elements) != 1 {
		t.Fatalf("expected init with 1 element, got %+v", msgs)
	}
}

func TestFinalSaveOnLastLeaveOrderedByIndex(t *testing.T) {
	store := &fakeStore{scene: []byte(`{}`)}
	hub, room, a, b := joinTwo(t, store)

	// b's element has a smaller fractional index than a's: it must sort first.
	room.ApplyUpdate(a, []json.RawMessage{el("e2", 1, "a2")})
	room.ApplyUpdate(b, []json.RawMessage{el("e1", 1, "a1")})

	hub.Leave("p1", room, a)
	hub.Leave("p1", room, b)

	saved := store.lastSaved()
	if saved == nil {
		t.Fatal("expected final save on last leave")
	}
	var scene struct {
		Elements []elementMeta `json:"elements"`
	}
	if err := json.Unmarshal(saved, &scene); err != nil {
		t.Fatalf("unmarshal saved scene: %v", err)
	}
	if len(scene.Elements) != 2 || scene.Elements[0].ID != "e1" || scene.Elements[1].ID != "e2" {
		t.Fatalf("expected [e1 e2] ordered by index, got %+v", scene.Elements)
	}
}

func TestFilesAddedOnceAndRelayed(t *testing.T) {
	store := &fakeStore{scene: []byte(`{}`)}
	_, room, a, b := joinTwo(t, store)

	files := map[string]json.RawMessage{"f1": json.RawMessage(`{"id":"f1"}`)}
	room.ApplyFiles(a, files)
	room.ApplyFiles(a, files) // duplicate must be a no-op

	count := 0
	for _, m := range b.messages() {
		if m.Type == "files-added" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 files-added relay, got %d", count)
	}
}

func TestKickSendsSessionClosed(t *testing.T) {
	store := &fakeStore{scene: []byte(`{}`)}
	hub, _, _, b := joinTwo(t, store)

	hub.KickUser("p1", "ub", "removed")

	found := false
	for _, m := range b.messages() {
		if m.Type == "session-closed" && m.Reason == "removed" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected b to receive session-closed(removed)")
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run from `backend/`: `go test ./collab/`
Expected: FAIL (package does not compile yet — room.go/hub.go missing).

- [ ] **Step 4: Create `backend/collab/room.go`**

```go
package collab

import (
	"encoding/json"
	"log"
	"sort"
	"sync"
	"time"
)

const saveDebounce = 5 * time.Second

// SceneStore abstracts scene persistence so Room is unit-testable.
type SceneStore interface {
	LoadScene(projectID string) ([]byte, error)
	SaveScene(projectID string, scene []byte) error
}

// RoomClient is what a Room needs from a connected client.
type RoomClient interface {
	Send(msg Message)
	User() UserInfo
	CanEdit() bool
	CloseSoon()
}

type storedElement struct {
	meta elementMeta
	raw  json.RawMessage
}

// Room holds the authoritative in-memory scene for one project while at
// least one client is connected. Higher element version always wins.
type Room struct {
	projectID string
	store     SceneStore

	mu        sync.Mutex
	clients   map[RoomClient]struct{}
	elements  map[string]storedElement
	order     []string // element ids in first-seen order (ordering fallback)
	appState  json.RawMessage
	files     map[string]json.RawMessage
	dirty     bool
	saveTimer *time.Timer
	closed    bool
}

type sceneJSON struct {
	Elements []json.RawMessage          `json:"elements"`
	AppState json.RawMessage            `json:"appState"`
	Files    map[string]json.RawMessage `json:"files"`
}

func newRoom(projectID string, store SceneStore) (*Room, error) {
	r := &Room{
		projectID: projectID,
		store:     store,
		clients:   make(map[RoomClient]struct{}),
		elements:  make(map[string]storedElement),
		files:     make(map[string]json.RawMessage),
		appState:  json.RawMessage("{}"),
	}
	raw, err := store.LoadScene(projectID)
	if err != nil {
		return nil, err
	}
	var scene sceneJSON
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &scene); err != nil {
			log.Printf("collab: project %s scene unparsable, starting empty: %v", projectID, err)
		}
	}
	for _, el := range scene.Elements {
		var meta elementMeta
		if err := json.Unmarshal(el, &meta); err != nil || meta.ID == "" {
			continue
		}
		r.elements[meta.ID] = storedElement{meta: meta, raw: el}
		r.order = append(r.order, meta.ID)
	}
	if len(scene.AppState) > 0 {
		r.appState = scene.AppState
	}
	if scene.Files != nil {
		r.files = scene.Files
	}
	return r, nil
}

// join registers the client, sends it the init snapshot, and announces it.
func (r *Room) join(c RoomClient) {
	r.mu.Lock()
	r.clients[c] = struct{}{}
	init := Message{
		Type:     "init",
		Elements: r.sortedElementsLocked(),
		Files:    r.copyFilesLocked(),
		Users:    r.usersLocked(),
	}
	joined := Message{Type: "user-joined", User: ptr(c.User()), Users: r.usersLocked()}
	r.mu.Unlock()

	c.Send(init)
	r.broadcast(joined, c)
}

// leave unregisters the client. Returns true when the room became empty
// (after running the final save).
func (r *Room) leave(c RoomClient) bool {
	r.mu.Lock()
	if _, ok := r.clients[c]; !ok {
		r.mu.Unlock()
		return false
	}
	delete(r.clients, c)
	empty := len(r.clients) == 0
	var left Message
	if empty {
		r.closed = true
		if r.saveTimer != nil {
			r.saveTimer.Stop()
			r.saveTimer = nil
		}
	} else {
		left = Message{Type: "user-left", User: ptr(c.User()), Users: r.usersLocked()}
	}
	r.mu.Unlock()

	if empty {
		r.save(true)
		return true
	}
	r.broadcast(left, nil)
	return false
}

// ApplyUpdate merges incoming elements (higher version wins) and relays
// the accepted ones to every other client.
func (r *Room) ApplyUpdate(from RoomClient, elements []json.RawMessage) {
	accepted := make([]json.RawMessage, 0, len(elements))
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	for _, el := range elements {
		var meta elementMeta
		if err := json.Unmarshal(el, &meta); err != nil || meta.ID == "" {
			continue
		}
		existing, ok := r.elements[meta.ID]
		if ok && existing.meta.Version >= meta.Version {
			continue
		}
		if !ok {
			r.order = append(r.order, meta.ID)
		}
		r.elements[meta.ID] = storedElement{meta: meta, raw: el}
		accepted = append(accepted, el)
	}
	if len(accepted) > 0 {
		r.dirty = true
		r.scheduleSaveLocked()
	}
	r.mu.Unlock()

	if len(accepted) > 0 {
		r.broadcast(Message{Type: "scene-update", Elements: accepted}, from)
	}
}

// ApplyFiles merges new files (add-only) and relays them.
func (r *Room) ApplyFiles(from RoomClient, files map[string]json.RawMessage) {
	added := make(map[string]json.RawMessage)
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	for id, f := range files {
		if _, ok := r.files[id]; !ok {
			r.files[id] = f
			added[id] = f
		}
	}
	if len(added) > 0 {
		r.dirty = true
		r.scheduleSaveLocked()
	}
	r.mu.Unlock()

	if len(added) > 0 {
		r.broadcast(Message{Type: "files-added", Files: added}, from)
	}
}

// RelayPointer forwards a cursor position; never stored.
func (r *Room) RelayPointer(from RoomClient, pointer json.RawMessage) {
	r.broadcast(Message{Type: "pointer", Pointer: pointer, User: ptr(from.User())}, from)
}

// kick disconnects every connection of one user with a reason.
func (r *Room) kick(userID, reason string) {
	r.mu.Lock()
	var targets []RoomClient
	for c := range r.clients {
		if c.User().ID == userID {
			targets = append(targets, c)
		}
	}
	r.mu.Unlock()
	for _, c := range targets {
		c.Send(Message{Type: "session-closed", Reason: reason})
		c.CloseSoon()
	}
}

// closeAll disconnects everyone (project deleted); nothing is saved.
func (r *Room) closeAll(reason string) {
	r.mu.Lock()
	r.closed = true
	r.dirty = false
	if r.saveTimer != nil {
		r.saveTimer.Stop()
		r.saveTimer = nil
	}
	targets := make([]RoomClient, 0, len(r.clients))
	for c := range r.clients {
		targets = append(targets, c)
	}
	r.clients = make(map[RoomClient]struct{})
	r.mu.Unlock()

	for _, c := range targets {
		c.Send(Message{Type: "session-closed", Reason: reason})
		c.CloseSoon()
	}
}

func (r *Room) scheduleSaveLocked() {
	if r.saveTimer != nil || r.closed {
		return
	}
	r.saveTimer = time.AfterFunc(saveDebounce, func() {
		r.mu.Lock()
		r.saveTimer = nil
		r.mu.Unlock()
		r.save(false)
	})
}

// save persists the snapshot when dirty. final=true means the room is
// shutting down: failures are logged loudly and never retried.
func (r *Room) save(final bool) {
	r.mu.Lock()
	if !r.dirty {
		r.mu.Unlock()
		return
	}
	r.dirty = false
	scene := sceneJSON{
		Elements: r.sortedElementsLocked(),
		AppState: r.appState,
		Files:    r.copyFilesLocked(),
	}
	r.mu.Unlock()

	data, err := json.Marshal(scene)
	if err != nil {
		log.Printf("collab: marshal scene %s: %v", r.projectID, err)
		return
	}
	if err := r.store.SaveScene(r.projectID, data); err != nil {
		if final {
			log.Printf("collab: FINAL SAVE FAILED for project %s — latest collab state lost: %v", r.projectID, err)
			return
		}
		log.Printf("collab: save scene %s (will retry): %v", r.projectID, err)
		r.mu.Lock()
		r.dirty = true
		r.scheduleSaveLocked()
		r.mu.Unlock()
	}
}

// sortedElementsLocked returns elements ordered by fractional index
// (lexicographic), falling back to first-seen order. Caller holds r.mu.
func (r *Room) sortedElementsLocked() []json.RawMessage {
	ids := make([]string, 0, len(r.elements))
	for _, id := range r.order {
		if _, ok := r.elements[id]; ok {
			ids = append(ids, id)
		}
	}
	sort.SliceStable(ids, func(i, j int) bool {
		a := r.elements[ids[i]].meta.Index
		b := r.elements[ids[j]].meta.Index
		if a == "" || b == "" {
			return false
		}
		return a < b
	})
	out := make([]json.RawMessage, 0, len(ids))
	for _, id := range ids {
		out = append(out, r.elements[id].raw)
	}
	return out
}

func (r *Room) copyFilesLocked() map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(r.files))
	for id, f := range r.files {
		out[id] = f
	}
	return out
}

func (r *Room) usersLocked() []UserInfo {
	out := make([]UserInfo, 0, len(r.clients))
	for c := range r.clients {
		out = append(out, c.User())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// broadcast sends msg to every client except `except` (nil = everyone).
func (r *Room) broadcast(msg Message, except RoomClient) {
	r.mu.Lock()
	targets := make([]RoomClient, 0, len(r.clients))
	for c := range r.clients {
		if c != except {
			targets = append(targets, c)
		}
	}
	r.mu.Unlock()
	for _, c := range targets {
		c.Send(msg)
	}
}
```

- [ ] **Step 5: Create `backend/collab/hub.go`**

```go
package collab

import "sync"

// Hub owns the set of live rooms, one per project.
type Hub struct {
	mu    sync.Mutex
	store SceneStore
	rooms map[string]*Room
}

func NewHub(store SceneStore) *Hub {
	return &Hub{store: store, rooms: make(map[string]*Room)}
}

// Join returns the project's room (creating and loading it when needed)
// with the client already registered and initialized.
func (h *Hub) Join(projectID string, c RoomClient) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[projectID]
	if !ok {
		var err error
		room, err = newRoom(projectID, h.store)
		if err != nil {
			return nil, err
		}
		h.rooms[projectID] = room
	}
	room.join(c)
	return room, nil
}

// Leave removes the client and tears the room down when it became empty.
func (h *Hub) Leave(projectID string, room *Room, c RoomClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room.leave(c) && h.rooms[projectID] == room {
		delete(h.rooms, projectID)
	}
}

// KickUser disconnects one user's connections (membership revoked).
func (h *Hub) KickUser(projectID, userID, reason string) {
	h.mu.Lock()
	room := h.rooms[projectID]
	h.mu.Unlock()
	if room != nil {
		room.kick(userID, reason)
	}
}

// CloseProject disconnects everyone and drops the room without saving
// (the project record is gone).
func (h *Hub) CloseProject(projectID, reason string) {
	h.mu.Lock()
	room := h.rooms[projectID]
	delete(h.rooms, projectID)
	h.mu.Unlock()
	if room != nil {
		room.closeAll(reason)
	}
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run from `backend/`: `go test ./collab/ -v && go vet ./... && go build ./...`
Expected: all tests PASS, vet and build clean.

- [ ] **Step 7: Commit**

```bash
git add backend/collab/messages.go backend/collab/room.go backend/collab/hub.go backend/collab/room_test.go
git commit -m "feat: add collab hub/room core with element-version merge"
```

---

### Task 3: WebSocket endpoint + wiring in main.go

**Files:**
- Create: `backend/collab/client.go`
- Create: `backend/collab/routes.go`
- Modify: `backend/main.go` (hub creation, `collab.Register`, delete hook)
- Modify: `backend/go.mod` / `backend/go.sum` (via `go get`)

**Interfaces:**
- Consumes: Task 2's `Hub`, `Room`, `Message`, `UserInfo`, `SceneStore`.
- Produces: `GET /ws/collab/:projectId?token=...` live; `collab.NewStore(app) *Store` (implements SceneStore); `collab.Register(e *core.ServeEvent, app *pocketbase.PocketBase, hub *Hub)`; helpers `resolveRole(project *models.Record, userID string) string` and `displayName(u *models.Record) string` (Task 4 uses both).

- [ ] **Step 1: Add gorilla/websocket**

Run from `backend/`: `go get github.com/gorilla/websocket@v1.5.3`

- [ ] **Step 2: Create `backend/collab/client.go`**

```go
package collab

import (
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 30 * time.Second
	sendBuffer = 256
	// Scenes with embedded images can be large.
	maxMessageSize = 32 << 20
)

// Client is one websocket connection inside a room.
type Client struct {
	conn *websocket.Conn
	user UserInfo
	send chan Message
}

func newClient(conn *websocket.Conn, user UserInfo) *Client {
	return &Client{conn: conn, user: user, send: make(chan Message, sendBuffer)}
}

func (c *Client) User() UserInfo { return c.user }
func (c *Client) CanEdit() bool  { return c.user.Role == "editor" }

// Send queues a message; a client that can't keep up gets disconnected
// (it will reconnect and receive a fresh init snapshot).
func (c *Client) Send(msg Message) {
	select {
	case c.send <- msg:
	default:
		c.conn.Close()
	}
}

// CloseSoon closes the connection after giving queued messages time to flush.
func (c *Client) CloseSoon() {
	time.AfterFunc(time.Second, func() { c.conn.Close() })
}

// readPump processes incoming messages until the connection dies.
// Runs on its own goroutine and owns room-membership cleanup.
func (c *Client) readPump(hub *Hub, projectID string, room *Room) {
	defer func() {
		hub.Leave(projectID, room, c)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		var msg Message
		if err := c.conn.ReadJSON(&msg); err != nil {
			return
		}
		switch msg.Type {
		case "scene-update":
			if c.CanEdit() {
				room.ApplyUpdate(c, msg.Elements)
			}
		case "files-added":
			if c.CanEdit() {
				room.ApplyFiles(c, msg.Files)
			}
		case "pointer":
			room.RelayPointer(c, msg.Pointer)
		}
	}
}

// writePump writes queued messages and keepalive pings. Exits when a
// write fails (e.g. after the connection is closed); the ping ticker
// guarantees that happens within pingPeriod even when idle.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

- [ ] **Step 3: Create `backend/collab/routes.go`**

```go
package collab

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/tools/types"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Auth is enforced via the token query param; origins differ between
	// the vite dev proxy and the embedded production frontend.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Store adapts PocketBase persistence to the SceneStore interface.
type Store struct {
	app *pocketbase.PocketBase
}

func NewStore(app *pocketbase.PocketBase) *Store { return &Store{app: app} }

func (s *Store) LoadScene(projectID string) ([]byte, error) {
	rec, err := s.app.Dao().FindRecordById("projects", projectID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(rec.Get("scene"))
}

func (s *Store) SaveScene(projectID string, scene []byte) error {
	rec, err := s.app.Dao().FindRecordById("projects", projectID)
	if err != nil {
		return err
	}
	rec.Set("scene", types.JsonRaw(scene))
	return s.app.Dao().SaveRecord(rec)
}

// Register mounts the collab routes.
func Register(e *core.ServeEvent, app *pocketbase.PocketBase, hub *Hub) {
	e.Router.GET("/ws/collab/:projectId", func(c echo.Context) error {
		return serveWS(c, app, hub)
	})
}

func serveWS(c echo.Context, app *pocketbase.PocketBase, hub *Hub) error {
	token := c.QueryParam("token")
	authRecord, err := app.Dao().FindAuthRecordByToken(token, app.Settings().RecordAuthToken.Secret)
	if err != nil || authRecord == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid auth token")
	}
	project, err := app.Dao().FindRecordById("projects", c.PathParam("projectId"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "project not found")
	}
	role := resolveRole(project, authRecord.Id)
	if role == "" {
		return echo.NewHTTPError(http.StatusForbidden, "not a member of this project")
	}

	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return nil // Upgrade already wrote the error response
	}

	client := newClient(conn, UserInfo{
		ID:   authRecord.Id,
		Name: displayName(authRecord),
		Role: role,
	})
	room, err := hub.Join(project.Id, client)
	if err != nil {
		log.Printf("collab: failed to open room %s: %v", project.Id, err)
		conn.Close()
		return nil
	}
	go client.writePump()
	go client.readPump(hub, project.Id, room)
	return nil
}

// resolveRole maps a user to their collab role on a project.
// Owner and editors edit; viewers watch; "" means no access.
func resolveRole(project *models.Record, userID string) string {
	if project.GetString("user") == userID {
		return "editor"
	}
	for _, id := range project.GetStringSlice("editors") {
		if id == userID {
			return "editor"
		}
	}
	for _, id := range project.GetStringSlice("viewers") {
		if id == userID {
			return "viewer"
		}
	}
	return ""
}

func displayName(u *models.Record) string {
	if name := u.GetString("name"); name != "" {
		return name
	}
	return strings.SplitN(u.Email(), "@", 2)[0]
}
```

- [ ] **Step 4: Wire into `backend/main.go`**

**4a** — add imports `"excalidraw-studio-backend/collab"` (grouped with the migrations import) and keep existing imports untouched.

**4b** — in `main()`, replace:

```go
	// Setup routes on serve
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		setupRoutes(e, app)
		return nil
	})
```

with:

```go
	hub := collab.NewHub(collab.NewStore(app))

	// Setup routes on serve
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		setupRoutes(e, app)
		collab.Register(e, app, hub)
		return nil
	})

	// Kill live collab sessions when a project is deleted via the API
	app.OnRecordAfterDeleteRequest("projects").Add(func(e *core.RecordDeleteEvent) error {
		hub.CloseProject(e.Record.Id, "deleted")
		return nil
	})
```

- [ ] **Step 5: Verify**

Run from `backend/`: `go build ./... && go vet ./... && go test ./collab/`
Expected: all clean.

Smoke test the endpoint: start `go run main.go serve --http=127.0.0.1:8092` in the background, then:

```bash
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8092/ws/collab/xxx?token=bad"
```

Expected: `401`. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add backend/collab/client.go backend/collab/routes.go backend/main.go backend/go.mod backend/go.sum
git commit -m "feat: add /ws/collab websocket endpoint with role-based rooms"
```

---

### Task 4: Membership endpoints

**Files:**
- Create: `backend/collab/members.go`
- Modify: `backend/collab/routes.go` (one line in `Register`)

**Interfaces:**
- Consumes: `resolveRole`/`displayName` (Task 3), `Hub.KickUser` (Task 2).
- Produces (Task 8's ShareDialog consumes):
  - `GET /api/collab/projects/:projectId/members` → `200 {"members": [{id, name, email, role}]}`
  - `POST /api/collab/projects/:projectId/members` body `{"email", "role"}` → `200 {"member": {...}}`; `404` unknown email, `400` bad role/owner/duplicate
  - `DELETE /api/collab/projects/:projectId/members/:userId` → `204`; kicks live sessions
  - All owner-only (`403` otherwise), record auth required.

- [ ] **Step 1: Create `backend/collab/members.go`**

```go
package collab

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
)

type memberInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

func registerMemberRoutes(e *core.ServeEvent, app *pocketbase.PocketBase, hub *Hub) {
	g := e.Router.Group("/api/collab", apis.RequireRecordAuth("users"))

	g.GET("/projects/:projectId/members", func(c echo.Context) error {
		project, err := ownedProject(c, app)
		if err != nil {
			return err
		}
		members := []memberInfo{}
		for _, role := range []string{"editor", "viewer"} {
			for _, id := range project.GetStringSlice(role + "s") {
				u, err := app.Dao().FindRecordById("users", id)
				if err != nil {
					continue // dangling relation; skip
				}
				members = append(members, memberInfo{
					ID: u.Id, Name: displayName(u), Email: u.Email(), Role: role,
				})
			}
		}
		return c.JSON(http.StatusOK, map[string]any{"members": members})
	})

	g.POST("/projects/:projectId/members", func(c echo.Context) error {
		project, err := ownedProject(c, app)
		if err != nil {
			return err
		}
		var body struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		}
		if err := c.Bind(&body); err != nil {
			return apis.NewBadRequestError("invalid request body", err)
		}
		if body.Role != "editor" && body.Role != "viewer" {
			return apis.NewBadRequestError("role must be editor or viewer", nil)
		}
		email := strings.TrimSpace(strings.ToLower(body.Email))
		user, err := app.Dao().FindAuthRecordByEmail("users", email)
		if err != nil {
			return apis.NewNotFoundError("no registered user with that email", err)
		}
		if user.Id == project.GetString("user") {
			return apis.NewBadRequestError("that user owns this project", nil)
		}
		for _, field := range []string{"editors", "viewers"} {
			for _, id := range project.GetStringSlice(field) {
				if id == user.Id {
					return apis.NewBadRequestError("already a member", nil)
				}
			}
		}
		field := body.Role + "s"
		project.Set(field, append(project.GetStringSlice(field), user.Id))
		if err := app.Dao().SaveRecord(project); err != nil {
			return apis.NewBadRequestError("failed to save member", err)
		}
		return c.JSON(http.StatusOK, map[string]any{
			"member": memberInfo{
				ID: user.Id, Name: displayName(user), Email: user.Email(), Role: body.Role,
			},
		})
	})

	g.DELETE("/projects/:projectId/members/:userId", func(c echo.Context) error {
		project, err := ownedProject(c, app)
		if err != nil {
			return err
		}
		userID := c.PathParam("userId")
		removed := false
		for _, field := range []string{"editors", "viewers"} {
			ids := project.GetStringSlice(field)
			kept := make([]string, 0, len(ids))
			for _, id := range ids {
				if id == userID {
					removed = true
					continue
				}
				kept = append(kept, id)
			}
			project.Set(field, kept)
		}
		if !removed {
			return apis.NewNotFoundError("not a member", nil)
		}
		if err := app.Dao().SaveRecord(project); err != nil {
			return apis.NewBadRequestError("failed to remove member", err)
		}
		hub.KickUser(project.Id, userID, "removed")
		return c.NoContent(http.StatusNoContent)
	})
}

// ownedProject loads :projectId and verifies the requester owns it.
func ownedProject(c echo.Context, app *pocketbase.PocketBase) (*models.Record, error) {
	auth, _ := c.Get(apis.ContextAuthRecordKey).(*models.Record)
	if auth == nil {
		return nil, apis.NewUnauthorizedError("auth required", nil)
	}
	project, err := app.Dao().FindRecordById("projects", c.PathParam("projectId"))
	if err != nil {
		return nil, apis.NewNotFoundError("project not found", err)
	}
	if project.GetString("user") != auth.Id {
		return nil, apis.NewForbiddenError("only the owner can manage members", nil)
	}
	return project, nil
}
```

- [ ] **Step 2: Mount in `Register`**

In `backend/collab/routes.go`, inside `Register`, after the `e.Router.GET("/ws/collab/:projectId", ...)` block add:

```go
	registerMemberRoutes(e, app, hub)
```

- [ ] **Step 3: Verify**

Run from `backend/`: `go build ./... && go vet ./... && go test ./collab/`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add backend/collab/members.go backend/collab/routes.go
git commit -m "feat: add owner-only membership endpoints (invite/list/remove)"
```

---

### Task 5: Frontend collab client library + types + vite proxy

**Files:**
- Create: `frontend/src/lib/collab.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: `pb` from `./pocketbase`; WS protocol from Tasks 2-3.
- Produces (Tasks 6-8 consume):
  - types.ts: `Project` gains `editors?: string[]; viewers?: string[]`; new `CollabMember { id; name; email; role: 'editor' | 'viewer' }`
  - collab.ts default export `CollabClient` — `new CollabClient(projectId, callbacks)`, `get isConnected: boolean`, `broadcastSceneElements(elements: readonly SceneElement[])` (100 ms trailing throttle), `broadcastFiles(files: SceneFiles)`, `sendPointer(x: number, y: number)` (50 ms throttle), `destroy()`
  - named exports: `collabColor(userId: string): string`, types `CollabRole`, `CollabUser`, `SceneElement`, `SceneFiles`, `PointerPosition`, `CollabCallbacks`

- [ ] **Step 1: Extend `frontend/src/types.ts`**

Replace the `Project` interface and append `CollabMember` so the file's interfaces read:

```ts
export interface Project {
  id: string;
  user: string;
  name: string;
  scene: any;
  editors?: string[];
  viewers?: string[];
  created: string;
  updated: string;
}

export interface User {
  id: string;
  email: string;
  username?: string;
}

export interface CollabMember {
  id: string;
  name: string;
  email: string;
  role: 'editor' | 'viewer';
}
```

(The `scene: any` line already exists and is part of the 7-problem lint baseline — keep it byte-identical, do not add any new `any`.)

- [ ] **Step 2: Create `frontend/src/lib/collab.ts`**

```ts
import pb from './pocketbase';

export type CollabRole = 'editor' | 'viewer';

export interface CollabUser {
  id: string;
  name: string;
  role: CollabRole;
}

export interface PointerPosition {
  x: number;
  y: number;
}

// Minimal structural view of an Excalidraw element — enough for delta
// tracking; the full element travels as an opaque payload.
export interface SceneElement {
  id: string;
  version: number;
  [key: string]: unknown;
}

export type SceneFiles = Record<string, unknown>;

interface ServerMessage {
  type: string;
  elements?: SceneElement[];
  files?: SceneFiles;
  pointer?: PointerPosition;
  user?: CollabUser;
  users?: CollabUser[];
  reason?: string;
}

export interface CollabCallbacks {
  onInit: (elements: SceneElement[], files: SceneFiles, users: CollabUser[]) => void;
  onSceneUpdate: (elements: SceneElement[]) => void;
  onFilesAdded: (files: SceneFiles) => void;
  onPointer: (user: CollabUser, pointer: PointerPosition) => void;
  onUsers: (users: CollabUser[]) => void;
  onSessionClosed: (reason: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

const BROADCAST_THROTTLE_MS = 100;
const POINTER_THROTTLE_MS = 50;
const MAX_RECONNECT_DELAY_MS = 15000;
// After this many connection attempts that never reached "open" (likely
// 401/403 at upgrade), stop retrying; REST autosave keeps working.
const MAX_FAILED_ATTEMPTS = 5;

export default class CollabClient {
  private ws: WebSocket | null = null;
  private readonly projectId: string;
  private readonly callbacks: CollabCallbacks;
  private lastSent = new Map<string, number>();
  private sentFileIds = new Set<string>();
  private destroyed = false;
  private connected = false;
  private failedAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingElements: readonly SceneElement[] | null = null;
  private lastPointerAt = 0;

  constructor(projectId: string, callbacks: CollabCallbacks) {
    this.projectId = projectId;
    this.callbacks = callbacks;
    this.connect();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private connect() {
    if (this.destroyed) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/collab/${this.projectId}?token=${encodeURIComponent(pb.authStore.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.failedAttempts = 0;
      this.connected = true;
      this.callbacks.onConnectionChange(true);
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) {
        this.callbacks.onConnectionChange(false);
      }
      if (this.destroyed) return;
      if (!wasConnected) {
        this.failedAttempts += 1;
        if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) return;
      }
      const delay = Math.min(1000 * 2 ** this.failedAttempts, MAX_RECONNECT_DELAY_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'init': {
        // Snapshot versions count as "already sent" so we don't echo them.
        this.lastSent = new Map();
        for (const el of msg.elements ?? []) {
          this.lastSent.set(el.id, el.version);
        }
        this.sentFileIds = new Set(Object.keys(msg.files ?? {}));
        this.callbacks.onUsers(msg.users ?? []);
        this.callbacks.onInit(msg.elements ?? [], msg.files ?? {}, msg.users ?? []);
        break;
      }
      case 'scene-update': {
        for (const el of msg.elements ?? []) {
          const prev = this.lastSent.get(el.id) ?? -1;
          if (el.version > prev) this.lastSent.set(el.id, el.version);
        }
        this.callbacks.onSceneUpdate(msg.elements ?? []);
        break;
      }
      case 'files-added': {
        for (const id of Object.keys(msg.files ?? {})) this.sentFileIds.add(id);
        this.callbacks.onFilesAdded(msg.files ?? {});
        break;
      }
      case 'pointer': {
        if (msg.user && msg.pointer) this.callbacks.onPointer(msg.user, msg.pointer);
        break;
      }
      case 'user-joined':
      case 'user-left': {
        this.callbacks.onUsers(msg.users ?? []);
        break;
      }
      case 'session-closed': {
        this.destroyed = true;
        this.callbacks.onSessionClosed(msg.reason ?? '');
        this.ws?.close();
        break;
      }
    }
  }

  // Queue the current element list; flushed at most every 100 ms
  // (trailing edge, so the final drag position always goes out).
  broadcastSceneElements(elements: readonly SceneElement[]) {
    this.pendingElements = elements;
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const els = this.pendingElements;
      this.pendingElements = null;
      if (els) this.flushElements(els);
    }, BROADCAST_THROTTLE_MS);
  }

  private flushElements(elements: readonly SceneElement[]) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const changed = elements.filter(
      (el) => el.version > (this.lastSent.get(el.id) ?? -1),
    );
    if (changed.length === 0) return;
    for (const el of changed) this.lastSent.set(el.id, el.version);
    this.ws.send(JSON.stringify({ type: 'scene-update', elements: changed }));
  }

  broadcastFiles(files: SceneFiles) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const added: SceneFiles = {};
    for (const [id, file] of Object.entries(files)) {
      if (!this.sentFileIds.has(id)) {
        this.sentFileIds.add(id);
        added[id] = file;
      }
    }
    if (Object.keys(added).length === 0) return;
    this.ws.send(JSON.stringify({ type: 'files-added', files: added }));
  }

  sendPointer(x: number, y: number) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastPointerAt < POINTER_THROTTLE_MS) return;
    this.lastPointerAt = now;
    this.ws.send(JSON.stringify({ type: 'pointer', pointer: { x, y } }));
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.ws?.close();
  }
}

// Deterministic per-user cursor/avatar color.
export function collabColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}
```

- [ ] **Step 3: Add the WS proxy to `frontend/vite.config.ts`**

Replace the `proxy` block with:

```ts
    proxy: {
      '/api': 'http://localhost:8092',
      '/_': 'http://localhost:8092',
      '/ws': {
        target: 'http://localhost:8092',
        ws: true,
      },
    },
```

- [ ] **Step 4: Verify build and lint**

Run from `frontend/`: `npm run build && npm run lint`
Expected: build exit 0; lint reports exactly the 7 pre-existing problems, nothing new.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/collab.ts frontend/src/types.ts frontend/vite.config.ts
git commit -m "feat: add CollabClient websocket library and collab types"
```

---

### Task 6: Canvas integration — sync, cursors, presence, viewer mode

**Files:**
- Modify: `frontend/src/components/Canvas.tsx` (full-file rewrite below)

**Interfaces:**
- Consumes: `CollabClient`, `collabColor`, collab types (Task 5); `reconcileElements`, `restoreElements`, `CaptureUpdateAction` from `@excalidraw/excalidraw`.
- Produces: no prop changes — `CanvasProps` stays `{ project: Project }` (CanvasRoute untouched).

- [ ] **Step 1: Rewrite `frontend/src/components/Canvas.tsx`**

Replace the entire file with:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Excalidraw,
  reconcileElements,
  restoreElements,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../types';
import pb from '../lib/pocketbase';
import CollabClient, { collabColor } from '../lib/collab';
import type { CollabUser, SceneElement, SceneFiles, PointerPosition } from '../lib/collab';

interface CanvasProps {
  project: Project;
}

interface RemoteCollaborator {
  username: string;
  color: { background: string; stroke: string };
  pointer?: { x: number; y: number; tool: 'pointer' };
}

export default function Canvas({ project }: CanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [collabConnected, setCollabConnected] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<CollabUser[]>([]);
  const navigate = useNavigate();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const pendingSaveRef = useRef<{
    projectId: string;
    sceneData: object;
    sceneString: string;
  } | null>(null);
  const collabRef = useRef<CollabClient | null>(null);
  const connectedRef = useRef(false);
  const collaboratorsRef = useRef(new Map<string, RemoteCollaborator>());

  const myId = pb.authStore.model?.id as string | undefined;
  const isViewer =
    project.user !== myId && !(project.editors ?? []).includes(myId ?? '');

  // Load scene when project changes
  useEffect(() => {
    if (excalidrawAPI) {
      const sceneData = project.scene || {};
      // Ensure collaborators is a Map (Excalidraw requirement)
      if (sceneData.appState) {
        sceneData.appState.collaborators = new Map();
      }
      excalidrawAPI.updateScene(sceneData);
      // Reset last saved when project changes
      lastSavedRef.current = '';
    }
  }, [project.id, excalidrawAPI]);

  // Collab session: one client per (project, mounted canvas)
  useEffect(() => {
    if (!excalidrawAPI) return;

    const api = excalidrawAPI;

    const pushCollaborators = () => {
      api.updateScene({ collaborators: new Map(collaboratorsRef.current) });
    };

    const applyRemote = (remote: SceneElement[]) => {
      if (remote.length === 0) return;
      const restored = restoreElements(
        remote as unknown as Parameters<typeof restoreElements>[0],
        null,
      );
      const reconciled = reconcileElements(
        api.getSceneElementsIncludingDeleted(),
        restored as unknown as Parameters<typeof reconcileElements>[1],
        api.getAppState(),
      );
      api.updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };

    const client = new CollabClient(project.id, {
      onInit: (elements, files) => {
        applyRemote(elements);
        if (Object.keys(files).length > 0) {
          api.addFiles(Object.values(files));
        }
        // Re-broadcast anything local that's newer than the snapshot
        // (e.g. edits made while disconnected).
        client.broadcastSceneElements(
          api.getSceneElementsIncludingDeleted() as unknown as SceneElement[],
        );
      },
      onSceneUpdate: applyRemote,
      onFilesAdded: (files) => {
        api.addFiles(Object.values(files));
      },
      onPointer: (user: CollabUser, pointer: PointerPosition) => {
        if (user.id === myId) return;
        const color = collabColor(user.id);
        collaboratorsRef.current.set(user.id, {
          username: user.name,
          color: { background: color, stroke: color },
          pointer: { x: pointer.x, y: pointer.y, tool: 'pointer' },
        });
        pushCollaborators();
      },
      onUsers: (users: CollabUser[]) => {
        setOnlineUsers(users);
        const online = new Set(users.map((u) => u.id));
        for (const id of Array.from(collaboratorsRef.current.keys())) {
          if (!online.has(id)) collaboratorsRef.current.delete(id);
        }
        for (const u of users) {
          if (u.id === myId || collaboratorsRef.current.has(u.id)) continue;
          const color = collabColor(u.id);
          collaboratorsRef.current.set(u.id, {
            username: u.name,
            color: { background: color, stroke: color },
          });
        }
        pushCollaborators();
      },
      onSessionClosed: (reason: string) => {
        window.alert(
          reason === 'removed'
            ? 'You have been removed from this project.'
            : 'This project has been deleted.',
        );
        navigate('/', { replace: true });
      },
      onConnectionChange: (connected: boolean) => {
        connectedRef.current = connected;
        setCollabConnected(connected);
        if (connected) {
          // Server owns persistence again — drop any queued REST save.
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
          }
          pendingSaveRef.current = null;
        }
      },
    });
    collabRef.current = client;

    return () => {
      collabRef.current = null;
      connectedRef.current = false;
      collaboratorsRef.current = new Map();
      client.destroy();
    };
    // navigate and myId are stable for the life of the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, excalidrawAPI]);

  // Auto-save on change (properly debounced)
  const handleChange = useCallback(
    (elements: any, appState: any, files: any) => {
      const collab = collabRef.current;
      if (collab && excalidrawAPI) {
        collab.broadcastSceneElements(
          excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as SceneElement[],
        );
        collab.broadcastFiles((files ?? {}) as SceneFiles);
      }

      // While the socket is live the server persists the scene.
      if (connectedRef.current) {
        return;
      }

      // Create scene data
      const sceneData = {
        elements,
        appState: {
          // Only save relevant appState, not everything
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
        },
        files,
      };

      // Check if actually changed
      const sceneString = JSON.stringify(sceneData);
      if (sceneString === lastSavedRef.current) {
        return; // No change, skip save
      }

      pendingSaveRef.current = {
        projectId: project.id,
        sceneData,
        sceneString,
      };

      // Clear existing timer
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce save (2 seconds)
      saveTimeoutRef.current = setTimeout(async () => {
        const pending = pendingSaveRef.current;
        if (!pending) return;
        pendingSaveRef.current = null;
        setIsSaving(true);
        try {
          await pb.collection('projects').update(pending.projectId, {
            scene: pending.sceneData,
          });
          lastSavedRef.current = pending.sceneString;
        } catch (err) {
          console.error('Failed to save:', err);
        } finally {
          setIsSaving(false);
        }
      }, 2000);
    },
    [project.id, excalidrawAPI]
  );

  // On unmount, flush any pending save so switching projects doesn't drop edits
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        pb.collection('projects')
          .update(pending.projectId, { scene: pending.sceneData })
          .catch((err) => {
            console.error('Failed to save:', err);
          });
      }
    };
  }, []);

  return (
    <div
      className="flex-1 relative"
      style={{
        flex: 1,
        height: '100%',
        width: '100%',
        position: 'relative',
      }}
    >
      {isSaving && (
        <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-md text-sm z-50">
          Saving...
        </div>
      )}

      {!collabConnected && (
        <div className="absolute top-4 right-4 bg-gray-700 text-white px-3 py-1 rounded-md text-sm z-50">
          Offline — changes saved directly
        </div>
      )}

      <div style={{ width: '100%', height: '100%' }}>
        <Excalidraw
          key={project.id}
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleChange}
          onPointerUpdate={(payload: { pointer: { x: number; y: number } }) => {
            collabRef.current?.sendPointer(payload.pointer.x, payload.pointer.y);
          }}
          viewModeEnabled={isViewer}
          initialData={project.scene || {}}
          renderTopRightUI={() => (
            <div className="flex items-center gap-1 mr-2">
              {onlineUsers.map((u) => (
                <div
                  key={u.id}
                  title={`${u.name}${u.role === 'viewer' ? ' (viewer)' : ''}`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: collabColor(u.id) }}
                >
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}
```

Notes for the implementer:

- The three `any` annotations in `handleChange` and the one in `useState<any>` are pre-existing lint-baseline problems — they must stay exactly as written above. Do not introduce any additional literal `any`.
- The `eslint-disable-next-line react-hooks/exhaustive-deps` comment is required: the collab effect must re-run only on `project.id`/`excalidrawAPI` changes, not when `navigate`/`myId` identities churn. If lint still reports a NEW error on that line, stop and report rather than working around it differently.
- `CaptureUpdateAction.NEVER` keeps remote updates out of the local undo history.
- Loop prevention: `CollabClient.handleMessage` records incoming element versions in `lastSent`, so the `onChange` fired by `updateScene` finds nothing newer to broadcast.

- [ ] **Step 2: Verify build and lint**

Run from `frontend/`: `npm run build && npm run lint`
Expected: build exit 0; lint exactly the 7 baseline problems (the rewritten Canvas.tsx keeps its 4 baseline `any` problems; nothing new anywhere).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Canvas.tsx
git commit -m "feat: live collab in canvas — element sync, cursors, presence, viewer mode"
```

---

### Task 7: App/Home/Sidebar — own vs "Shared with me"

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Home.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: new `projects` rules (Task 1) — an unfiltered `getFullList` returns own + shared records.
- Produces:
  - `SidebarProps` gains `sharedProjects: Project[]` (after `projects`)
  - `HomeProps` becomes `{ projects: Project[]; sharedProjects: Project[]; loaded: boolean }`
  - Task 8 adds the Share action into the Sidebar structure created here.

- [ ] **Step 1: App.tsx — fetch all visible projects and split**

**1a** — add state after the `projects` state line:

```tsx
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
```

**1b** — replace the body of `loadProjects` with:

```tsx
  const loadProjects = useCallback(async () => {
    try {
      const myId = pb.authStore.model?.id;
      // Collection rules scope this to own + member projects
      const records = await pb.collection('projects').getFullList({
        sort: '-created',
      });
      const all = records as unknown as Project[];
      setProjects(all.filter((p) => p.user === myId));
      setSharedProjects(all.filter((p) => p.user !== myId));
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setProjectsLoaded(true);
    }
  }, []);
```

**1c** — in `handleLogout`, after `setProjects([]);` add:

```tsx
    setSharedProjects([]);
```

**1d** — pass the new prop to Sidebar (after `projects={projects}`):

```tsx
          sharedProjects={sharedProjects}
```

**1e** — pass it to both `Home` route elements (`/` and `*`):

```tsx
<Home projects={projects} sharedProjects={sharedProjects} loaded={projectsLoaded} />
```

- [ ] **Step 2: Home.tsx — redirect priority own → shared → welcome**

Replace the interface and component body:

```tsx
import { Navigate } from 'react-router-dom';
import Welcome from './Welcome';
import type { Project } from '../types';

interface HomeProps {
  projects: Project[];
  sharedProjects: Project[];
  loaded: boolean;
}

export default function Home({ projects, sharedProjects, loaded }: HomeProps) {
  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (projects.length > 0) {
    return <Navigate to={`/project/${projects[0].id}`} replace />;
  }

  if (sharedProjects.length > 0) {
    return <Navigate to={`/project/${sharedProjects[0].id}`} replace />;
  }

  return <Welcome />;
}
```

- [ ] **Step 3: Sidebar.tsx — accept sharedProjects and render the section**

**3a** — add to `SidebarProps` after `projects: Project[];`:

```tsx
  sharedProjects: Project[];
```

and to the destructured parameters after `projects,`:

```tsx
  sharedProjects,
```

**3b** — below the `visibleProjects` line, add the search-aware split (myId + shared visibility):

```tsx
  const myId = pb.authStore.model?.id;
  const visibleShared = isSearching
    ? (searchResults ?? sharedProjects).filter((p) => p.user !== myId)
    : sharedProjects;
```

and change the existing `visibleProjects` line to keep only own projects while searching:

```tsx
  const visibleProjects = isSearching
    ? (searchResults ?? projects).filter((p) => p.user === myId)
    : projects;
```

**3c** — after the own-projects `</div>` that closes `<div className="space-y-1">` (the `visibleProjects.map` block), and BEFORE the two empty-state paragraphs, insert:

```tsx
          {/* Shared with me */}
          {visibleShared.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-400 uppercase mt-6 mb-3">
                Shared with me
              </h2>
              <div className="space-y-1">
                {visibleShared.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors truncate ${
                      currentProjectId === project.id
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-gray-800 text-gray-300'
                    }`}
                  >
                    {project.name}
                  </button>
                ))}
              </div>
            </>
          )}
```

(No 3-dot menu here: rename/delete/share are owner actions.)

**3d** — update the two empty states so they account for shared items:

```tsx
          {isSearching &&
            searchResults &&
            searchResults.length === 0 && (
            <p className="text-gray-500 text-sm text-center mt-4">
              No projects found
            </p>
          )}

          {!isSearching &&
            projects.length === 0 &&
            sharedProjects.length === 0 &&
            !isCreating && (
            <p className="text-gray-500 text-sm text-center mt-4">
              No projects yet. Create one!
            </p>
          )}
```

- [ ] **Step 4: Verify build and lint**

Run from `frontend/`: `npm run build && npm run lint`
Expected: build exit 0; lint exactly the 7 baseline problems.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Home.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: split sidebar into own and shared-with-me projects"
```

---

### Task 8: ShareDialog + Share action

**Files:**
- Create: `frontend/src/components/ShareDialog.tsx`
- Modify: `frontend/src/components/Sidebar.tsx` (Share menu item + dialog state)

**Interfaces:**
- Consumes: membership endpoints (Task 4) via `pb.send`; `CollabMember` type (Task 5); Sidebar structure (Task 7).
- Produces: `ShareDialog` default export with props `{ project: Project; onClose: () => void }`.

- [ ] **Step 1: Create `frontend/src/components/ShareDialog.tsx`**

```tsx
import { useState, useEffect } from 'react';
import pb from '../lib/pocketbase';
import type { Project, CollabMember } from '../types';

interface ShareDialogProps {
  project: Project;
  onClose: () => void;
}

export default function ShareDialog({ project, onClose }: ShareDialogProps) {
  const [members, setMembers] = useState<CollabMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pb.send(`/api/collab/projects/${project.id}/members`, { method: 'GET' })
      .then((res) => {
        if (!cancelled) {
          setMembers((res as { members: CollabMember[] }).members);
        }
      })
      .catch((err) => {
        console.error('Failed to load members:', err);
        if (!cancelled) {
          setMembers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await pb.send(`/api/collab/projects/${project.id}/members`, {
        method: 'POST',
        body: { email: email.trim(), role },
      });
      const member = (res as { member: CollabMember }).member;
      setMembers((prev) => [...(prev ?? []), member]);
      setEmail('');
    } catch (err) {
      console.error('Failed to invite member:', err);
      const message =
        (err as { response?: { message?: string } }).response?.message ??
        'Failed to invite member';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setError('');
    try {
      await pb.send(`/api/collab/projects/${project.id}/members/${userId}`, {
        method: 'DELETE',
      });
      setMembers((prev) => (prev ?? []).filter((m) => m.id !== userId));
    } catch (err) {
      console.error('Failed to remove member:', err);
      setError('Failed to remove member');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-1">Share Project</h3>
        <p className="text-gray-600 text-sm mb-4 truncate">{project.name}</p>

        <form onSubmit={handleInvite} className="flex gap-2 mb-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@email.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
            className="px-2 py-2 border border-gray-300 rounded text-sm text-gray-700 focus:outline-none focus:border-blue-500"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm text-white"
          >
            Invite
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <div className="max-h-56 overflow-y-auto">
          {members === null && (
            <p className="text-gray-500 text-sm">Loading members...</p>
          )}
          {members !== null && members.length === 0 && (
            <p className="text-gray-500 text-sm">
              No members yet. Invite someone by email.
            </p>
          )}
          {(members ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">
                  {m.name}{' '}
                  <span className="text-gray-400">({m.role})</span>
                </p>
                <p className="text-xs text-gray-500 truncate">{m.email}</p>
              </div>
              <button
                onClick={() => handleRemove(m.id)}
                className="ml-3 text-sm text-red-600 hover:text-red-700 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm text-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into Sidebar.tsx**

**2a** — add the import after the `useProjectSearch` import:

```tsx
import ShareDialog from './ShareDialog';
```

**2b** — add state after the `contextMenuId` state line:

```tsx
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
```

**2c** — in the own-project context menu, add a Share button ABOVE the Rename button:

```tsx
                        <button
                          onClick={() => {
                            setShareProjectId(project.id);
                            setContextMenuId(null);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 text-gray-300 flex items-center gap-2"
                        >
                          🔗 Share
                        </button>
```

**2d** — at the end of the component's JSX, right after the delete-confirmation modal block (inside the fragment), add:

```tsx
      {/* Share dialog */}
      {shareProjectId && (
        <ShareDialog
          project={projects.find((p) => p.id === shareProjectId)!}
          onClose={() => setShareProjectId(null)}
        />
      )}
```

- [ ] **Step 3: Verify build and lint**

Run from `frontend/`: `npm run build && npm run lint`
Expected: build exit 0; lint exactly the 7 baseline problems.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ShareDialog.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: add share dialog with invite/remove members"
```

---

### Task 9: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Terminal 1: `cd backend && go run main.go serve --http=127.0.0.1:8092`
Terminal 2: `cd frontend && npm run dev`

Open http://localhost:5173. Accounts: `test@example.com` / `test12345` exists. Create a second account `test2@example.com` / `test12345` via the app's register form (or via the admin UI at http://127.0.0.1:8092/_/ if the app has no register form).

Use two browser windows: one normal (user A/test), one incognito (user B/test2).

- [ ] **Step 2: Run the spec checklist**

1. A invites B (by email) as **editor** on a project → project appears in B's "Shared with me" section (B may need a refresh; live sidebar updates are out of scope).
2. A and B draw simultaneously on **different** elements → both edits survive on both screens within ~a second.
3. A and B drag the **same** element → one deterministic winner, no flicker loop.
4. Live cursors with name labels visible both ways; avatar stack (top-right) shows both users.
5. A removes B, re-invites as **viewer** → B's canvas is view-only; B's cursor still visible to A.
6. Kill B's network (DevTools offline) as editor → B keeps editing, "Offline" badge appears, edits autosave via REST → restore network → B reconnects, edits merge and appear on A's screen.
7. A removes B while B has the project open → B gets the "removed" notice and lands on `/`.
8. Both close the project (navigate away) → reopen → last collab state was persisted.
9. A deletes the project while B is in it → B gets the "deleted" notice and lands on `/` (or welcome).
10. Search finds shared projects (they render under "Shared with me"); B sees no rename/delete/share controls on shared items; B's `/` redirects into own or shared project correctly.

Expected: all 10 pass. If any fail, fix before proceeding (superpowers:systematic-debugging skill).
