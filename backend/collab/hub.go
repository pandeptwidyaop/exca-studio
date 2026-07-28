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
// with the client already registered and initialized. h.mu is held only
// for map access — never across store or client I/O.
func (h *Hub) Join(projectID string, c RoomClient) (*Room, error) {
	for {
		h.mu.Lock()
		room, ok := h.rooms[projectID]
		if !ok {
			room = newRoom(projectID, h.store)
			h.rooms[projectID] = room
		}
		h.mu.Unlock()

		if err := room.ensureLoaded(); err != nil {
			h.mu.Lock()
			if h.rooms[projectID] == room {
				delete(h.rooms, projectID)
			}
			h.mu.Unlock()
			return nil, err
		}

		if room.join(c) {
			return room, nil
		}

		// The room closed between lookup and join (last client left or the
		// project was deleted). Drop the dead room and retry.
		h.mu.Lock()
		if h.rooms[projectID] == room {
			delete(h.rooms, projectID)
		}
		h.mu.Unlock()
	}
}

// Leave removes the client and tears the room down when it became empty.
func (h *Hub) Leave(projectID string, room *Room, c RoomClient) {
	if room.leave(c) {
		h.mu.Lock()
		if h.rooms[projectID] == room {
			delete(h.rooms, projectID)
		}
		h.mu.Unlock()
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
