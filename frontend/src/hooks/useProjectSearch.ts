import { useState, useEffect } from 'react';
import pb from '../lib/pocketbase';
import type { Project } from '../types';

// Server-side project search: debounced 300ms, results scoped to the
// requesting user by PocketBase collection rules.
export default function useProjectSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Project[] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!query.trim()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      pb.collection('projects')
        .getFullList({
          sort: '-created',
          filter: pb.filter('name ~ {:q}', { q: query.trim() }),
        })
        .then((records) => {
          if (!cancelled) {
            setResults(records as unknown as Project[]);
          }
        })
        .catch((err) => {
          console.error('Failed to search projects:', err);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, refreshTick]);

  const refresh = () => setRefreshTick((t) => t + 1);

  return { query, setQuery, results, refresh };
}
