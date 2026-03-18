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
      <Sidebar
        projects={projects}
        currentProject={currentProject}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onLogout={handleLogout}
      />
      <Canvas project={currentProject} />
    </div>
  );
}

export default App;
