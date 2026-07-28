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
