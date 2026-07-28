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
