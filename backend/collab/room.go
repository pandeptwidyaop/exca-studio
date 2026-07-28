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
