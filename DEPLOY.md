# Deployment Guide

## Quick Start (Development)

### 1. Start Backend
```bash
cd backend
go run main.go serve --http=127.0.0.1:8092
```

Backend will start at http://127.0.0.1:8092
- API: http://127.0.0.1:8092/api/
- Admin UI: http://127.0.0.1:8092/_/

### 2. Start Frontend (Dev Mode)
```bash
cd frontend
npm run dev
```

Frontend dev server at http://localhost:5173

---

## Production Deployment

### Build Frontend
```bash
cd frontend
npm run build
# Output: frontend/dist/
```

### Run Backend (serves frontend)
```bash
cd backend
go build -o excalidraw-studio-backend
./excalidraw-studio-backend serve --http=0.0.0.0:8092
```

Access the app at http://your-server:8092

---

## Database

PocketBase stores data in `backend/pb_data/` (auto-created on first run).

### Reset Database
```bash
rm -rf backend/pb_data/
# Restart backend to recreate
```

### Migrations
Migrations are in `backend/migrations/` and run automatically on startup.

---

## GitHub Repo Setup

To push to GitHub:

1. **Create repo manually** on https://github.com/new
   - Name: `excalidraw-studio`
   - Public/Private: your choice

2. **Push code:**
   ```bash
   git remote add origin https://github.com/pandeptwidyaop/excalidraw-studio.git
   git branch -M main
   git push -u origin main
   ```

---

## Tech Stack

- **Backend:** Go 1.22 + PocketBase v0.22.25
- **Frontend:** React 19 + Vite + TypeScript + TailwindCSS + Excalidraw
- **Database:** SQLite (via PocketBase)
- **Port:** 8092
