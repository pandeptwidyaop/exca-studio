export interface Project {
  id: string;
  user: string;
  name: string;
  scene: any;
  editors?: string[];
  viewers?: string[];
  created: string;
  updated: string;
}

export interface User {
  id: string;
  email: string;
  username?: string;
}

export interface CollabMember {
  id: string;
  name: string;
  email: string;
  role: 'editor' | 'viewer';
}
