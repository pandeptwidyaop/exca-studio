import { useState, useEffect, useCallback } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { Project } from '../types';
import pb from '../lib/pocketbase';

interface CanvasProps {
  project: Project | null;
}

export default function Canvas({ project }: CanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load scene when project changes
  useEffect(() => {
    if (excalidrawAPI && project) {
      const sceneData = project.scene || {};
      excalidrawAPI.updateScene(sceneData);
    }
  }, [project, excalidrawAPI]);

  // Auto-save on change (debounced)
  const handleChange = useCallback(
    (elements: any, appState: any, files: any) => {
      if (!project) return;

      // Debounce save
      const saveTimer = setTimeout(async () => {
        setIsSaving(true);
        try {
          await pb.collection('projects').update(project.id, {
            scene: {
              elements,
              appState,
              files,
            },
          });
        } catch (err) {
          console.error('Failed to save:', err);
        } finally {
          setIsSaving(false);
        }
      }, 1000);

      return () => clearTimeout(saveTimer);
    },
    [project]
  );

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100">
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

  return (
    <div className="flex-1 relative">
      {isSaving && (
        <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-md text-sm z-50">
          Saving...
        </div>
      )}

      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onChange={handleChange}
        initialData={project.scene || {}}
      />
    </div>
  );
}
