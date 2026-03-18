package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"

	_ "excalidraw-studio-backend/migrations"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

//go:embed web/*
var embeddedFiles embed.FS

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

	// Serve embedded frontend (SPA)
	serveFrontend(e)
}

func serveFrontend(e *core.ServeEvent) {
	// Get the web subdirectory from embedded files
	webFS, err := fs.Sub(embeddedFiles, "web")
	if err != nil {
		log.Printf("Warning: Could not access embedded web files: %v", err)
		return
	}

	log.Println("Serving embedded frontend")

	// Serve static files
	e.Router.GET("/*", func(c echo.Context) error {
		path := c.Request().URL.Path

		// Skip API routes and PocketBase admin
		if strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/_") {
			return echo.NewHTTPError(http.StatusNotFound)
		}

		// Remove leading slash for fs.FS
		filePath := strings.TrimPrefix(path, "/")
		if filePath == "" {
			filePath = "index.html"
		}

		// Try to serve the file
		file, err := webFS.Open(filePath)
		if err == nil {
			file.Close()
			return c.FileFS(filePath, webFS)
		}

		// SPA fallback - serve index.html for client-side routing
		return c.FileFS("index.html", webFS)
	})
}
