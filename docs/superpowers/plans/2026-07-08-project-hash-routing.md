# Project Hash Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The open project is reflected in the URL as `/#/project/:id`, so refreshing (or bookmarking) returns to the same project.

**Architecture:** Wrap the app in `HashRouter` (react-router-dom, already a dependency). The URL becomes the source of truth for the active project: `App.tsx` keeps auth + project list + sidebar as the layout, while the content area renders `<Routes>` — `/` redirects to the most recent project (or shows a welcome screen when the user has none), and `/project/:id` fetches that project fresh and renders the Excalidraw canvas. Invalid ids redirect to `/`.

**Tech Stack:** React 19, TypeScript, react-router-dom v7 (`HashRouter`, `Routes`, `Route`, `Navigate`, `useParams`, `useNavigate`, `useMatch`), PocketBase JS SDK, Vite, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-07-08-project-hash-routing-design.md`

## Global Constraints

- URL shape is exactly `#/project/:id` (HashRouter path `/project/:id`).
- Root `/` auto-opens the **first** project from the list sorted `-created` (most recent); welcome screen only when the user has zero projects.
- No new npm dependencies; react-router-dom `^7.13.1` is already in `frontend/package.json`.
- No backend (Go) changes — hash fragments never reach the server.
- Frontend has no test infrastructure; each task's gate is `npm run build` (runs `tsc -b && vite build`) from `frontend/`, plus the manual verification task at the end. Do NOT add a test framework.
- All `npm` commands run from `/Users/pande/Works/exca-studio/frontend/`.
- Follow existing code style: default-exported function components, Tailwind classes, `as unknown as Project` casts for PocketBase records, `console.error` in catch blocks.

---

### Task 1: Welcome component

Extract the "no project selected" welcome screen out of `Canvas.tsx` into its own component so the `/` route can use it. (Canvas itself is simplified later, in Task 4.)

**Files:**
- Create: `frontend/src/components/Welcome.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `Welcome` — default export, `() => JSX`, no props. Used by `Home.tsx` in Task 3.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/Welcome.tsx` with exactly:

```tsx
export default function Welcome() {
  return (
    <div className="h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-700 mb-2">
          Welcome to Excalidraw Studio
        </h2>
        <p className="text-gray-500">
          Select a project from the sidebar or create a new one
        </p>
      </div>
    </div>
  );
}
```

(Copy of the null-project branch in `Canvas.tsx:84-97`, with `flex-1` swapped for `h-full` — the parent container is not a flex row, so `h-full` is what actually stretches it.)

- [ ] **Step 2: Verify build passes**

Run from `frontend/`: `npm run build`
Expected: exits 0 (`tsc -b` clean, Vite build succeeds). The file is not imported yet — that is fine, unused files do not fail the build.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Welcome.tsx
git commit -m "feat: extract Welcome screen component"
```

---

### Task 2: CanvasRoute component

Route component for `/project/:id`: reads the id from the URL, fetches the project fresh from PocketBase (this replaces the old `handleSelectProject` refetch in `App.tsx`), renders `Canvas`. A failed fetch (404 / not owned) redirects to `/`.

**Files:**
- Create: `frontend/src/components/CanvasRoute.tsx`

**Interfaces:**
- Consumes: `Canvas` from `./Canvas` (current signature `{ project: Project | null }` — passing a non-null `Project` type-checks both before and after Task 4 narrows it), `pb` from `../lib/pocketbase`, `Project` from `../types`.
- Produces: `CanvasRoute` — default export, `() => JSX`, no props (reads `:id` via `useParams`). Mounted at `/project/:id` in Task 4.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/CanvasRoute.tsx` with exactly:

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Canvas from './Canvas';
import pb from '../lib/pocketbase';
import type { Project } from '../types';

export default function CanvasRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProject(null);

    if (!id) return;

    pb.collection('projects')
      .getOne(id)
      .then((record) => {
        if (!cancelled) {
          setProject(record as unknown as Project);
        }
      })
      .catch((err) => {
        console.error('Failed to load project:', err);
        if (!cancelled) {
          navigate('/', { replace: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return <Canvas project={project} />;
}
```

Notes for the implementer:
- The `cancelled` flag prevents a stale response from overwriting state after the id changes (and makes React 19 StrictMode double-invocation harmless in dev).
- `setProject(null)` on id change shows the loading state instead of the previous project's canvas.
- The catch redirects instead of showing an error screen — per spec, an invalid or foreign id silently lands on `/`.

- [ ] **Step 2: Verify build passes**

Run from `frontend/`: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CanvasRoute.tsx
git commit -m "feat: add CanvasRoute for /project/:id"
```

---

### Task 3: Home component

Index route (`/`): while the project list is loading, show a spinner text; once loaded, redirect to the most recent project, or show `Welcome` when the user has no projects.

**Files:**
- Create: `frontend/src/components/Home.tsx`

**Interfaces:**
- Consumes: `Welcome` from `./Welcome` (Task 1), `Project` from `../types`.
- Produces: `Home` — default export with props `{ projects: Project[]; loaded: boolean }`. Mounted at `/` and `*` in Task 4; `projects` must already be sorted `-created` (App does this), `loaded` is App's `projectsLoaded` flag.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/Home.tsx` with exactly:

```tsx
import { Navigate } from 'react-router-dom';
import Welcome from './Welcome';
import type { Project } from '../types';

interface HomeProps {
  projects: Project[];
  loaded: boolean;
}

export default function Home({ projects, loaded }: HomeProps) {
  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (projects.length > 0) {
    return <Navigate to={`/project/${projects[0].id}`} replace />;
  }

  return <Welcome />;
}
```

The `loaded` guard matters: without it, a refresh at `/` would flash the welcome screen (empty list) before the projects arrive and the redirect happens.

- [ ] **Step 2: Verify build passes**

Run from `frontend/`: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Home.tsx
git commit -m "feat: add Home route with redirect to latest project"
```

---

### Task 4: Wire up the router

The integration task: mount `HashRouter` in `main.tsx`, replace `currentProject` state in `App.tsx` with URL-driven routing, switch `Sidebar` to id-based highlighting with explicit created/renamed/deleted callbacks, and narrow `Canvas` to a non-null project (its welcome branch moved to `Welcome` in Task 1).

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx` (full rewrite below)
- Modify: `frontend/src/components/Sidebar.tsx` (props + 3 handlers + highlight)
- Modify: `frontend/src/components/Canvas.tsx` (require non-null project, drop welcome branch)

**Interfaces:**
- Consumes: `Home` (Task 3: `{ projects, loaded }`), `CanvasRoute` (Task 2: no props), `Welcome` indirectly via Home.
- Produces: new `SidebarProps` — `{ projects: Project[]; currentProjectId: string | null; onSelectProject: (project: Project) => void; onCreated: (project: Project) => void; onRenamed: () => void; onDeleted: (projectId: string) => void; onLogout: () => void; onToggle: () => void }`. New `CanvasProps` — `{ project: Project }` (non-null).

- [ ] **Step 1: Mount HashRouter in main.tsx**

Replace the full contents of `frontend/src/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import '@excalidraw/excalidraw/index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
```

- [ ] **Step 2: Rewrite App.tsx**

Replace the full contents of `frontend/src/App.tsx` with:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useMatch } from 'react-router-dom';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import Home from './components/Home';
import CanvasRoute from './components/CanvasRoute';
import pb from './lib/pocketbase';
import type { Project } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const match = useMatch('/project/:id');
  const activeProjectId = match?.params.id ?? null;

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = () => {
      setIsAuthenticated(pb.authStore.isValid);
      setLoading(false);
    };

    checkAuth();

    // Subscribe to auth changes
    pb.authStore.onChange(() => {
      checkAuth();
    });
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const records = await pb.collection('projects').getFullList({
        sort: '-created',
        filter: `user = "${pb.authStore.model?.id}"`,
      });

      setProjects(records as unknown as Project[]);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setProjectsLoaded(true);
    }
  }, []);

  // Load projects when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadProjects();
    }
  }, [isAuthenticated, loadProjects]);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    pb.authStore.clear();
    setIsAuthenticated(false);
    setProjects([]);
    setProjectsLoaded(false);
  };

  const handleSelectProject = (project: Project) => {
    navigate(`/project/${project.id}`);
  };

  const handleCreated = async (project: Project) => {
    await loadProjects();
    navigate(`/project/${project.id}`);
  };

  const handleRenamed = () => {
    loadProjects();
  };

  const handleDeleted = async (projectId: string) => {
    await loadProjects();
    if (projectId === activeProjectId) {
      navigate('/', { replace: true });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          projects={projects}
          currentProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onCreated={handleCreated}
          onRenamed={handleRenamed}
          onDeleted={handleDeleted}
          onLogout={handleLogout}
          onToggle={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 relative">
        {/* Burger menu when sidebar is hidden */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 z-50 p-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 shadow-lg"
            title="Show sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <Routes>
          <Route path="/" element={<Home projects={projects} loaded={projectsLoaded} />} />
          <Route path="/project/:id" element={<CanvasRoute />} />
          <Route path="*" element={<Home projects={projects} loaded={projectsLoaded} />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
```

Behavior notes:
- `activeProjectId` comes from the URL (`useMatch`) — there is no `currentProject` state anymore.
- `handleDeleted` reloads **before** navigating so that `Home` redirects to the next remaining project, not the deleted one.
- The `*` route catches garbage hashes (e.g. `#/foo`) and treats them as `/`.
- Logout keeps the hash; after re-login `CanvasRoute` re-resolves it (spec: project restored after login).

- [ ] **Step 3: Update Sidebar.tsx**

Four edits in `frontend/src/components/Sidebar.tsx`:

**3a — props interface and destructuring** (currently lines 5-21). Replace:

```tsx
interface SidebarProps {
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  onLogout: () => void;
  onToggle: () => void;
}

export default function Sidebar({
  projects,
  currentProject,
  onSelectProject,
  onCreateProject,
  onLogout,
  onToggle,
}: SidebarProps) {
```

with:

```tsx
interface SidebarProps {
  projects: Project[];
  currentProjectId: string | null;
  onSelectProject: (project: Project) => void;
  onCreated: (project: Project) => void;
  onRenamed: () => void;
  onDeleted: (projectId: string) => void;
  onLogout: () => void;
  onToggle: () => void;
}

export default function Sidebar({
  projects,
  currentProjectId,
  onSelectProject,
  onCreated,
  onRenamed,
  onDeleted,
  onLogout,
  onToggle,
}: SidebarProps) {
```

**3b — handleCreate** (currently lines 29-46): capture the created record and pass it up. Replace:

```tsx
    try {
      await pb.collection('projects').create({
        user: pb.authStore.model?.id,
        name: newProjectName,
        scene: {},
      });

      setNewProjectName('');
      setIsCreating(false);
      onCreateProject();
    } catch (err) {
      console.error('Failed to create project:', err);
    }
```

with:

```tsx
    try {
      const record = await pb.collection('projects').create({
        user: pb.authStore.model?.id,
        name: newProjectName,
        scene: {},
      });

      setNewProjectName('');
      setIsCreating(false);
      onCreated(record as unknown as Project);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
```

**3c — handleRename and handleDelete** (currently lines 48-68). Replace `onCreateProject(); // refresh list` in `handleRename` with `onRenamed();`, and in `handleDelete` with `onDeleted(projectId);`:

```tsx
  const handleRename = async (projectId: string) => {
    if (!editName.trim()) return;
    try {
      await pb.collection('projects').update(projectId, { name: editName });
      setEditingId(null);
      setEditName('');
      onRenamed();
    } catch (err) {
      console.error('Failed to rename project:', err);
    }
  };

  const handleDelete = async (projectId: string) => {
    try {
      await pb.collection('projects').delete(projectId);
      setDeleteConfirmId(null);
      onDeleted(projectId);
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };
```

**3d — highlight comparisons**: replace both occurrences of `currentProject?.id === project.id` (in the project button class at ~line 210 and the 3-dot menu button class at ~line 226) with `currentProjectId === project.id`.

- [ ] **Step 4: Narrow Canvas.tsx to a non-null project**

Three edits in `frontend/src/components/Canvas.tsx`:

**4a — props** (lines 6-8): replace

```tsx
interface CanvasProps {
  project: Project | null;
}
```

with

```tsx
interface CanvasProps {
  project: Project;
}
```

**4b — load-scene effect** (lines 17-28): `project` is now always set; drop the null checks. Replace the effect body with:

```tsx
  // Load scene when project changes
  useEffect(() => {
    if (excalidrawAPI) {
      const sceneData = project.scene || {};
      // Ensure collaborators is a Map (Excalidraw requirement)
      if (sceneData.appState) {
        sceneData.appState.collaborators = new Map();
      }
      excalidrawAPI.updateScene(sceneData);
      // Reset last saved when project changes
      lastSavedRef.current = '';
    }
  }, [project?.id, excalidrawAPI]);
```

and in `handleChange` (line 33) delete the line `if (!project) return;`.

**4c — welcome branch** (lines 84-97): delete the entire `if (!project) { return (...); }` block — it moved to `Welcome.tsx` in Task 1.

- [ ] **Step 5: Verify build and lint pass**

Run from `frontend/`:

```bash
npm run build
npm run lint
```

Expected: both exit 0. If `eslint` flags `project?.id` in the Canvas effect deps now that `project` is non-null, change the dep to `project.id`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/main.tsx frontend/src/App.tsx frontend/src/components/Sidebar.tsx frontend/src/components/Canvas.tsx
git commit -m "feat: URL hash routing for projects (#/project/:id)"
```

---

### Task 5: Manual verification

No test infrastructure exists; this is the acceptance gate from the spec. Requires a running stack.

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Terminal 1: `cd backend && go run main.go serve --http=127.0.0.1:8092`
Terminal 2: `cd frontend && npm run dev`
Open http://localhost:5173 and log in (register a user if the database is empty).

- [ ] **Step 2: Run the spec checklist**

1. Open a project → URL becomes `/#/project/<id>`. Refresh → same project stays open.
2. Open a second project, use browser back/forward → switches between the two projects.
3. Manually edit the hash to `#/project/bogus123` → redirected to the most recent project (or welcome if none), no crash.
4. Delete the active project via the sidebar 3-dot menu → lands on the next project (or welcome), URL updated.
5. Logout while on `#/project/<id>`, log back in → that same project opens.
6. Log in fresh at `/` → most recent project auto-opens and the hash updates.
7. Create a new project → it opens immediately and the hash points at it.
8. Draw something, wait for "Saving..." to clear, refresh → drawing persists.

Expected: all 8 pass. If any fail, fix before proceeding (systematic-debugging skill).

- [ ] **Step 3: Production build smoke test (optional but recommended)**

Vite outputs to `frontend/dist/` (default — no `outDir` override in `vite.config.ts`); the Go binary embeds `backend/web/`, so copy the build output there first (this mirrors what CI does):

```bash
cd frontend && npm run build
rm -rf ../backend/web && cp -r dist ../backend/web
cd ../backend && go build -o /tmp/exca-test && /tmp/exca-test serve --http=127.0.0.1:8093
```

Open http://127.0.0.1:8093, verify item 1 of the checklist, then stop the server and delete `/tmp/exca-test`.

`backend/web/` is tracked in git (the committed frontend build that `go:embed` uses). Rebuilding it dirties the working tree with hashed asset filenames. After the smoke test, either restore it (`git restore backend/web && git clean -fd backend/web`) or commit the fresh build as its own commit (`git add backend/web && git commit -m "chore: rebuild embedded frontend"`) — ask the user which they prefer if unsure.
