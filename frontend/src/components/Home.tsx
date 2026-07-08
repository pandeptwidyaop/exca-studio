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
