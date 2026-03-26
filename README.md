# 🎨 Exca Studio

A self-hosted, multi-project whiteboard application built on top of [Excalidraw](https://excalidraw.com/). Create unlimited projects, each with its own persistent canvas — all with user authentication.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?logo=go)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![PocketBase](https://img.shields.io/badge/PocketBase-0.22-B8DBE4)](https://pocketbase.io/)

## ✨ Features

- 🔐 **User Authentication** — Login/register with email & password
- 📁 **Multi-Project** — Create and manage unlimited projects
- 🎨 **Full Excalidraw** — All drawing tools, shapes, text, arrows, and more
- 💾 **Auto-Save** — Canvas changes saved automatically (1s debounce)
- 📱 **Collapsible Sidebar** — Clean UI with toggle-able project navigation
- 🌙 **Dark Theme** — Easy on the eyes
- 🚀 **Single Binary** — Frontend embedded in Go binary for easy deployment

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Go 1.22+ with [PocketBase](https://pocketbase.io/) (embedded SQLite + auth + admin) |
| **Frontend** | React 19 + TypeScript + Vite + TailwindCSS |
| **Canvas** | [@excalidraw/excalidraw](https://www.npmjs.com/package/@excalidraw/excalidraw) |
| **Database** | SQLite (via PocketBase, zero config) |

## 🚀 Quick Start

### Prerequisites
- Go 1.22+
- Node.js 18+
- npm

### Development

```bash
# Clone
git clone https://github.com/pandeptwidyaop/exca-studio.git
cd exca-studio

# Backend (Terminal 1)
cd backend
go mod download
go run main.go serve --http=127.0.0.1:8092

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Production (Single Binary)

```bash
# Build frontend
cd frontend
npm install && npm run build

# Build Go binary (embeds frontend)
cd backend
go build -o exca-studio
./exca-studio serve --http=0.0.0.0:8092
```

Open http://your-server:8092

## 📦 Project Structure

```
exca-studio/
├── backend/
│   ├── main.go              # Entry point + API routes
│   ├── migrations/          # Database schema (auto-run)
│   ├── pb_data/             # SQLite data (auto-created)
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Auth.tsx     # Login/Register UI
│   │   │   ├── Sidebar.tsx  # Project list + navigation
│   │   │   └── Canvas.tsx   # Excalidraw wrapper + auto-save
│   │   ├── lib/
│   │   │   └── pocketbase.ts # API client
│   │   ├── App.tsx          # Main app logic
│   │   └── main.tsx         # React entry
│   ├── package.json
│   └── vite.config.ts
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
└── README.md
```

## 💾 Database Schema

**users** (built-in PocketBase)
| Field | Type | Description |
|-------|------|-------------|
| id | string | Primary key (auto) |
| email | text | User email |
| password | text | Hashed password |

**projects**
| Field | Type | Description |
|-------|------|-------------|
| id | string | Primary key (auto) |
| user | relation | FK → users |
| name | text | Project name |
| scene | json | Excalidraw scene data |
| created | datetime | Auto timestamp |
| updated | datetime | Auto timestamp |

## 🔑 Admin Panel

PocketBase includes a built-in admin UI:

```
http://localhost:8092/_/
```

Create an admin account on first visit to manage users, projects, and collections.

## 🐳 Docker

Pull from GitHub Container Registry:

```bash
docker pull ghcr.io/pandeptwidyaop/exca-studio:latest

docker run -d \
  -p 8092:8092 \
  -v exca-data:/data \
  ghcr.io/pandeptwidyaop/exca-studio:latest
```

Open http://localhost:8092

### Docker Compose

```yaml
services:
  exca-studio:
    image: ghcr.io/pandeptwidyaop/exca-studio:latest
    ports:
      - "8092:8092"
    volumes:
      - exca-data:/data
    restart: unless-stopped

volumes:
  exca-data:
```

## 📦 Releases

Releases follow [Semantic Versioning](https://semver.org/). Pre-built binaries for Linux, macOS, and Windows are available on the [Releases page](https://github.com/pandeptwidyaop/exca-studio/releases).

To create a new release:
```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers GitHub Actions to:
1. Build binaries for all platforms (linux/mac/windows × amd64/arm64)
2. Create a GitHub Release with assets
3. Build & push Docker image to `ghcr.io/pandeptwidyaop/exca-studio`

## 🗺 Roadmap

- [ ] Real-time collaboration (multiple users on same canvas)
- [ ] Project sharing via public links
- [ ] Thumbnail previews in project list
- [ ] Export to PNG/SVG/PDF
- [ ] Version history & undo
- [ ] Project folders/categories
- [ ] Light/dark theme toggle
- [ ] Mobile responsive improvements

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

## 📄 License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Excalidraw](https://excalidraw.com/) — The amazing open-source whiteboard
- [PocketBase](https://pocketbase.io/) — Backend in a single file
- [TailwindCSS](https://tailwindcss.com/) — Utility-first CSS

---

**Built with ❤️ by [Pande Putu Widya Okta Pratama](https://github.com/pandeptwidyaop)**
