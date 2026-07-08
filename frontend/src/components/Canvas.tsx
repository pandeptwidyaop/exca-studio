import { useState, useEffect, useCallback, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { Project } from '../types';
import pb from '../lib/pocketbase';

interface CanvasProps {
  project: Project;
}

export default function Canvas({ project }: CanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const pendingSaveRef = useRef<{
    projectId: string;
    sceneData: object;
    sceneString: string;
  } | null>(null);

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
  }, [project.id, excalidrawAPI]);

  // Auto-save on change (properly debounced)
  const handleChange = useCallback(
    (elements: any, appState: any, files: any) => {
      // Create scene data
      const sceneData = {
        elements,
        appState: {
          // Only save relevant appState, not everything
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
        },
        files,
      };

      // Check if actually changed
      const sceneString = JSON.stringify(sceneData);
      if (sceneString === lastSavedRef.current) {
        return; // No change, skip save
      }

      pendingSaveRef.current = {
        projectId: project.id,
        sceneData,
        sceneString,
      };

      // Clear existing timer
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce save (2 seconds)
      saveTimeoutRef.current = setTimeout(async () => {
        const pending = pendingSaveRef.current;
        if (!pending) return;
        pendingSaveRef.current = null;
        setIsSaving(true);
        try {
          await pb.collection('projects').update(pending.projectId, {
            scene: pending.sceneData,
          });
          lastSavedRef.current = pending.sceneString;
        } catch (err) {
          console.error('Failed to save:', err);
        } finally {
          setIsSaving(false);
        }
      }, 2000);
    },
    [project.id]
  );

  // On unmount, flush any pending save so switching projects doesn't drop edits
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        pb.collection('projects')
          .update(pending.projectId, { scene: pending.sceneData })
          .catch((err) => {
            console.error('Failed to save:', err);
          });
      }
    };
  }, []);

  return (
    <div 
      className="flex-1 relative"
      style={{ 
        flex: 1, 
        height: '100%', 
        width: '100%',
        position: 'relative',
      }}
    >
      {isSaving && (
        <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-md text-sm z-50">
          Saving...
        </div>
      )}

      <div style={{ width: '100%', height: '100%' }}>
        <Excalidraw
          key={project.id}
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleChange}
          initialData={project.scene || {}}
        />
      </div>
    </div>
  );
}
