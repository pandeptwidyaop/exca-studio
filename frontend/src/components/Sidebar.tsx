import { useState } from 'react';
import type { Project } from '../types';
import pb from '../lib/pocketbase';

interface SidebarProps {
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  onLogout: () => void;
}

export default function Sidebar({
  projects,
  currentProject,
  onSelectProject,
  onCreateProject,
  onLogout,
}: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

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
  };

  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">Excalidraw Studio</h1>
        <p className="text-sm text-gray-400 mt-1">
          {pb.authStore.model?.email}
        </p>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase">
            Projects
          </h2>
          <button
            onClick={() => setIsCreating(true)}
            className="text-blue-400 hover:text-blue-300 text-xl"
            title="New Project"
          >
            +
          </button>
        </div>

        {/* New Project Form */}
        {isCreating && (
          <form onSubmit={handleCreate} className="mb-3">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm mb-2 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-xs py-1 rounded"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setNewProjectName('');
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Projects */}
        <div className="space-y-1">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                currentProject?.id === project.id
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-800 text-gray-300'
              }`}
            >
              {project.name}
            </button>
          ))}
        </div>

        {projects.length === 0 && !isCreating && (
          <p className="text-gray-500 text-sm text-center mt-4">
            No projects yet. Create one!
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <button
          onClick={onLogout}
          className="w-full bg-red-600 hover:bg-red-700 py-2 rounded text-sm"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
