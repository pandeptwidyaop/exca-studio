export interface Project {
  id: string;
  user: string;
  name: string;
  scene: any;
  created: string;
  updated: string;
}

export interface User {
  id: string;
  email: string;
  username?: string;
}
