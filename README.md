# Excalidraw Studio

Multi-project Excalidraw with user authentication. Built with Go, PocketBase, React, and Excalidraw.

## Features

- 🔐 User authentication (login/register)
- 📁 Multiple projects management
- 🎨 Excalidraw canvas integration
- 💾 Auto-save to database
- 📱 Sidebar project list with quick switching

## Tech Stack

**Backend:**
- Go 1.22+
- PocketBase (embedded database + auth)

**Frontend:**
- React 18
- TypeScript
- Vite
- TailwindCSS
- @excalidraw/excalidraw

## Getting Started

### Prerequisites

- Go 1.22+
- Node.js 18+
- npm/yarn

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/pandeptwidyaop/excalidraw-studio.git
   cd excalidraw-studio
   ```

2. **Setup Backend:**
   ```bash
   cd backend
   go mod download
   ```

3. **Setup Frontend:**
   ```bash
   cd frontend
   npm install
   ```

### Development

1. **Start Backend (Port 8092):**
   ```bash
   cd backend
   go run main.go serve
   ```

2. **Start Frontend (Port 5173):**
   ```bash
   cd frontend
   npm run dev
   ```

3. Open http://localhost:5173

### Production Build

1. **Build Frontend:**
   ```bash
   cd frontend
   npm run build
   ```

2. **Run Backend (serves frontend):**
   ```bash
   cd backend
   go run main.go serve --http=0.0.0.0:8092
   ```

## Project Structure

```
excalidraw-studio/
├── backend/
│   ├── main.go              # Entry point
│   ├── migrations/          # Database migrations
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── lib/             # PocketBase client
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## Database Schema

**users** (built-in PocketBase collection)
- id
- email
- password (hashed)

**projects**
- id
- user (relation → users)
- name (text)
- scene (json) - Excalidraw scene data
- created (auto)
- updated (auto)

## License

MIT
