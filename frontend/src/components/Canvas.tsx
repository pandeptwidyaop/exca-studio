import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Excalidraw,
  reconcileElements,
  restoreElements,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../types';
import pb from '../lib/pocketbase';
import CollabClient, { collabColor } from '../lib/collab';
import type { CollabUser, SceneElement, SceneFiles, PointerPosition } from '../lib/collab';

interface CanvasProps {
  project: Project;
}

interface RemoteCollaborator {
  username: string;
  color: { background: string; stroke: string };
  pointer?: { x: number; y: number; tool: 'pointer' };
}

export default function Canvas({ project }: CanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [collabConnected, setCollabConnected] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<CollabUser[]>([]);
  const navigate = useNavigate();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const pendingSaveRef = useRef<{
    projectId: string;
    sceneData: object;
    sceneString: string;
  } | null>(null);
  const collabRef = useRef<CollabClient | null>(null);
  const connectedRef = useRef(false);
  const collaboratorsRef = useRef(new Map<string, RemoteCollaborator>());

  const myId = pb.authStore.model?.id as string | undefined;
  const isViewer =
    project.user !== myId && !(project.editors ?? []).includes(myId ?? '');

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

  // Collab session: one client per (project, mounted canvas)
  useEffect(() => {
    if (!excalidrawAPI) return;

    const api = excalidrawAPI;

    const pushCollaborators = () => {
      api.updateScene({ collaborators: new Map(collaboratorsRef.current) });
    };

    const applyRemote = (remote: SceneElement[]) => {
      if (remote.length === 0) return;
      const restored = restoreElements(
        remote as unknown as Parameters<typeof restoreElements>[0],
        null,
      );
      const reconciled = reconcileElements(
        api.getSceneElementsIncludingDeleted(),
        restored as unknown as Parameters<typeof reconcileElements>[1],
        api.getAppState(),
      );
      api.updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };

    const client = new CollabClient(project.id, {
      onInit: (elements, files) => {
        applyRemote(elements);
        if (Object.keys(files).length > 0) {
          api.addFiles(Object.values(files));
        }
        // Re-broadcast anything local that's newer than the snapshot
        // (e.g. edits made while disconnected).
        client.broadcastSceneElements(
          api.getSceneElementsIncludingDeleted() as unknown as SceneElement[],
        );
      },
      onSceneUpdate: applyRemote,
      onFilesAdded: (files) => {
        api.addFiles(Object.values(files));
      },
      onPointer: (user: CollabUser, pointer: PointerPosition) => {
        if (user.id === myId) return;
        const color = collabColor(user.id);
        collaboratorsRef.current.set(user.id, {
          username: user.name,
          color: { background: color, stroke: color },
          pointer: { x: pointer.x, y: pointer.y, tool: 'pointer' },
        });
        pushCollaborators();
      },
      onUsers: (users: CollabUser[]) => {
        setOnlineUsers(users);
        const online = new Set(users.map((u) => u.id));
        for (const id of Array.from(collaboratorsRef.current.keys())) {
          if (!online.has(id)) collaboratorsRef.current.delete(id);
        }
        for (const u of users) {
          if (u.id === myId || collaboratorsRef.current.has(u.id)) continue;
          const color = collabColor(u.id);
          collaboratorsRef.current.set(u.id, {
            username: u.name,
            color: { background: color, stroke: color },
          });
        }
        pushCollaborators();
      },
      onSessionClosed: (reason: string) => {
        window.alert(
          reason === 'removed'
            ? 'You have been removed from this project.'
            : 'This project has been deleted.',
        );
        navigate('/', { replace: true });
      },
      onConnectionChange: (connected: boolean) => {
        connectedRef.current = connected;
        setCollabConnected(connected);
        if (connected) {
          // Server owns persistence again — drop any queued REST save.
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
          }
          pendingSaveRef.current = null;
        }
      },
    });
    collabRef.current = client;

    return () => {
      collabRef.current = null;
      connectedRef.current = false;
      collaboratorsRef.current = new Map();
      client.destroy();
    };
    // navigate and myId are stable for the life of the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, excalidrawAPI]);

  // Auto-save on change (properly debounced)
  const handleChange = useCallback(
    (elements: any, appState: any, files: any) => {
      const collab = collabRef.current;
      if (collab && excalidrawAPI) {
        collab.broadcastSceneElements(
          excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as SceneElement[],
        );
        collab.broadcastFiles((files ?? {}) as SceneFiles);
      }

      // While the socket is live the server persists the scene.
      if (connectedRef.current) {
        return;
      }

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
    [project.id, excalidrawAPI]
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

      {!collabConnected && (
        <div className="absolute top-4 right-4 bg-gray-700 text-white px-3 py-1 rounded-md text-sm z-50">
          Offline — changes saved directly
        </div>
      )}

      <div style={{ width: '100%', height: '100%' }}>
        <Excalidraw
          key={project.id}
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleChange}
          onPointerUpdate={(payload: { pointer: { x: number; y: number } }) => {
            collabRef.current?.sendPointer(payload.pointer.x, payload.pointer.y);
          }}
          viewModeEnabled={isViewer}
          initialData={project.scene || {}}
          renderTopRightUI={() => (
            <div className="flex items-center gap-1 mr-2">
              {onlineUsers.map((u) => (
                <div
                  key={u.id}
                  title={`${u.name}${u.role === 'viewer' ? ' (viewer)' : ''}`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: collabColor(u.id) }}
                >
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}
