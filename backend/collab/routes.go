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
