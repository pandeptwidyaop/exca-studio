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

func TestJoinLoadFailure(t *testing.T) {
	store := &fakeStore{failed: true}
	hub := NewHub(store)
	a := &fakeClient{user: UserInfo{ID: "ua", Name: "A", Role: "editor"}}
	if _, err := hub.Join("p1", a); err == nil {
		t.Fatal("expected error when scene load fails")
	}
	if _, err := hub.Join("p1", a); err == nil {
		t.Fatal("expected error on second join too (broken room must not be cached)")
	}
}
