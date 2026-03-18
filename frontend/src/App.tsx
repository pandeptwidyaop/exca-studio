import { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import pb from './lib/pocketbase';
import type { Project } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  // Load projects when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadProjects();
    }
  }, [isAuthenticated]);

  const loadProjects = async () => {
    try {
      const records = await pb.collection('projects').getFullList({
        sort: '-created',
        filter: `user = "${pb.authStore.model?.id}"`,
      });

      setProjects(records as unknown as Project[]);

      // Auto-select first project if none selected
      if (!currentProject && records.length > 0) {
        setCurrentProject(records[0] as unknown as Project);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    pb.authStore.clear();
    setIsAuthenticated(false);
    setProjects([]);
    setCurrentProject(null);
  };

  const handleSelectProject = async (project: Project) => {
    // Fetch fresh data from server to get latest scene
    try {
      const fresh = await pb.collection('projects').getOne(project.id);
      setCurrentProject(fresh as unknown as Project);
    } catch (err) {
      console.error('Failed to load project:', err);
      setCurrentProject(project); // Fallback to cached
    }
  };

  const handleCreateProject = () => {
    loadProjects(); // Reload projects after creation
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
          currentProject={currentProject}
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
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
        <Canvas project={currentProject} />
      </div>
    </div>
  );
}

export default App;
