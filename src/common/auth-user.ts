import { Role } from '../users/role.enum';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}
