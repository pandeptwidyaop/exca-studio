package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	_ "excalidraw-studio-backend/migrations"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

func main() {
	app := pocketbase.New()

	// Enable automigrate for development
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: true,
	})

	// Setup routes on serve
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		setupRoutes(e, app)
		return nil
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func setupRoutes(e *core.ServeEvent, app *pocketbase.PocketBase) {
	// API routes group
	apiGroup := e.Router.Group("/api")

	// Health check endpoint
	apiGroup.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"status":  "ok",
			"service": "excalidraw-studio-backend",
		})
	})

	// Serve frontend (SPA)
	serveFrontend(e)
}

func serveFrontend(e *core.ServeEvent) {
	// Determine frontend path
	frontendPath := os.Getenv("FRONTEND_PATH")
	if frontendPath == "" {
		frontendPath = "../frontend/dist"
	}

	absPath, err := filepath.Abs(frontendPath)
	if err != nil {
		log.Printf("Warning: Could not resolve frontend path: %v", err)
		return
	}

	// Check if frontend exists
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		log.Printf("Warning: Frontend not found at %s", absPath)
		return
	}

	log.Printf("Serving frontend from: %s", absPath)

	// Serve static files
	e.Router.GET("/*", func(c echo.Context) error {
		path := c.Request().URL.Path

		// Skip API routes
		if strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/_") {
			return echo.NewHTTPError(http.StatusNotFound)
		}

		// Try to serve the file
		filePath := filepath.Join(absPath, path)
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			return c.File(filePath)
		}

		// SPA fallback - serve index.html for client-side routing
		indexPath := filepath.Join(absPath, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			return c.File(indexPath)
		}

		return echo.NewHTTPError(http.StatusNotFound)
	})
}
