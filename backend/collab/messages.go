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
