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

  // A project fetched for a previous id is stale — render loading until the fetch for this id lands
  const current = project && project.id === id ? project : null;

  if (!current) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return <Canvas project={current} />;
}
