import { useState, useEffect } from 'react';
import pb from '../lib/pocketbase';
import type { Project, CollabMember } from '../types';

interface ShareDialogProps {
  project: Project;
  onClose: () => void;
}

export default function ShareDialog({ project, onClose }: ShareDialogProps) {
  const [members, setMembers] = useState<CollabMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pb.send(`/api/collab/projects/${project.id}/members`, { method: 'GET' })
      .then((res) => {
        if (!cancelled) {
          setMembers((res as { members: CollabMember[] }).members);
        }
      })
      .catch((err) => {
        console.error('Failed to load members:', err);
        if (!cancelled) {
          setMembers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await pb.send(`/api/collab/projects/${project.id}/members`, {
        method: 'POST',
        body: { email: email.trim(), role },
      });
      const member = (res as { member: CollabMember }).member;
      setMembers((prev) => [...(prev ?? []), member]);
      setEmail('');
    } catch (err) {
      console.error('Failed to invite member:', err);
      const message =
        (err as { response?: { message?: string } }).response?.message ??
        'Failed to invite member';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setError('');
    try {
      await pb.send(`/api/collab/projects/${project.id}/members/${userId}`, {
        method: 'DELETE',
      });
      setMembers((prev) => (prev ?? []).filter((m) => m.id !== userId));
    } catch (err) {
      console.error('Failed to remove member:', err);
      setError('Failed to remove member');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-1">Share Project</h3>
        <p className="text-gray-600 text-sm mb-4 truncate">{project.name}</p>

        <form onSubmit={handleInvite} className="flex gap-2 mb-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@email.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
            className="px-2 py-2 border border-gray-300 rounded text-sm text-gray-700 focus:outline-none focus:border-blue-500"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm text-white"
          >
            Invite
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <div className="max-h-56 overflow-y-auto">
          {members === null && (
            <p className="text-gray-500 text-sm">Loading members...</p>
          )}
          {members !== null && members.length === 0 && (
            <p className="text-gray-500 text-sm">
              No members yet. Invite someone by email.
            </p>
          )}
          {(members ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">
                  {m.name}{' '}
                  <span className="text-gray-400">({m.role})</span>
                </p>
                <p className="text-xs text-gray-500 truncate">{m.email}</p>
              </div>
              <button
                onClick={() => handleRemove(m.id)}
                className="ml-3 text-sm text-red-600 hover:text-red-700 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm text-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
