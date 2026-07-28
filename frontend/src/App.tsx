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
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
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
      const myId = pb.authStore.model?.id;
      // Collection rules scope this to own + member projects
      const records = await pb.collection('projects').getFullList({
        sort: '-created',
      });
      const all = records as unknown as Project[];
      setProjects(all.filter((p) => p.user === myId));
      setSharedProjects(all.filter((p) => p.user !== myId));
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
    setSharedProjects([]);
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
      // replace, not push: don't leave the deleted project's URL in history
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
          sharedProjects={sharedProjects}
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
          <Route path="/" element={<Home projects={projects} sharedProjects={sharedProjects} loaded={projectsLoaded} />} />
          <Route path="/project/:id" element={<CanvasRoute />} />
          <Route path="*" element={<Home projects={projects} sharedProjects={sharedProjects} loaded={projectsLoaded} />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
