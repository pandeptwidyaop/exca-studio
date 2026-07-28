package collab

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/dbx"
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
		// Emails are stored with their original casing; match case-insensitively.
		email := strings.ToLower(strings.TrimSpace(body.Email))
		matches, err := app.Dao().FindRecordsByExpr("users",
			dbx.NewExp("LOWER([[email]]) = {:email}", dbx.Params{"email": email}))
		if err != nil || len(matches) == 0 {
			return apis.NewNotFoundError("no registered user with that email", err)
		}
		user := matches[0]
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
