import { useState } from 'react';
import type { Project } from '../types';
import pb from '../lib/pocketbase';

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
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);

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

  const handleRename = async (projectId: string) => {
    if (!editName.trim()) return;
    try {
      await pb.collection('projects').update(projectId, { name: editName });
      setEditingId(null);
      setEditName('');
      onCreateProject(); // refresh list
    } catch (err) {
      console.error('Failed to rename project:', err);
    }
  };

  const handleDelete = async (projectId: string) => {
    try {
      await pb.collection('projects').delete(projectId);
      setDeleteConfirmId(null);
      onCreateProject(); // refresh list
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const startEdit = (project: Project) => {
    setEditingId(project.id);
    setEditName(project.name);
    setContextMenuId(null);
  };

  const startDelete = (projectId: string) => {
    setDeleteConfirmId(projectId);
    setContextMenuId(null);
  };

  return (
    <>
      <div
        className="w-64 bg-gray-900 text-white flex flex-col h-full"
        style={{
          width: '16rem',
          backgroundColor: '#111827',
          color: 'white',
          flexShrink: 0,
          zIndex: 10,
        }}
        onClick={() => setContextMenuId(null)} // close context menu on click outside
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Exca Studio</h1>
            <button
              onClick={onToggle}
              className="p-1 hover:bg-gray-700 rounded"
              title="Hide sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
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
              <div key={project.id} className="relative group">
                {/* Editing mode */}
                {editingId === project.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRename(project.id);
                    }}
                    className="flex gap-1"
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 bg-gray-800 border border-blue-500 rounded text-sm focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditName('');
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                      title="Save"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setEditName('');
                      }}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
                      title="Cancel"
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center">
                    <button
                      onClick={() => onSelectProject(project)}
                      className={`flex-1 text-left px-3 py-2 rounded-l text-sm transition-colors truncate ${
                        currentProject?.id === project.id
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-gray-800 text-gray-300'
                      }`}
                    >
                      {project.name}
                    </button>
                    {/* 3-dot menu button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenuId(
                          contextMenuId === project.id ? null : project.id
                        );
                      }}
                      className={`px-2 py-2 rounded-r text-sm transition-colors opacity-0 group-hover:opacity-100 ${
                        currentProject?.id === project.id
                          ? 'bg-blue-700 hover:bg-blue-800 text-white opacity-100'
                          : 'hover:bg-gray-700 text-gray-400'
                      } ${contextMenuId === project.id ? 'opacity-100' : ''}`}
                      title="Options"
                    >
                      ⋮
                    </button>

                    {/* Context menu */}
                    {contextMenuId === project.id && (
                      <div
                        className="absolute right-0 top-8 bg-gray-800 border border-gray-700 rounded shadow-lg z-20 min-w-[120px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => startEdit(project)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 text-gray-300 flex items-center gap-2"
                        >
                          ✏️ Rename
                        </button>
                        <button
                          onClick={() => startDelete(project.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-red-900 text-red-400 flex items-center gap-2"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
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

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setDeleteConfirmId(null)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Delete Project?
            </h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete "
              <strong>
                {projects.find((p) => p.id === deleteConfirmId)?.name}
              </strong>
              "? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
