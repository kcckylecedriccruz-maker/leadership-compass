export const ROLES = ['admin', 'employee'] as const;

export type Role = (typeof ROLES)[number];


export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  manages_talents: boolean;
  is_talent: boolean;
  must_change_password: boolean;
  temp_password_expires_at: string | null;
  tour_seen_at: string | null;
  is_active: boolean;
  modules: ModuleAccess;
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const MODULES = ['dashboard', 'cycles', 'people', 'talents', 'assignments', 'users', 'audit', 'settings'] as const;
export type Module = (typeof MODULES)[number];
/** 0 = no access, 1 = view, 2 = edit. Active admins always have 2 everywhere. */
export type AccessLevel = 0 | 1 | 2;
export type ModuleAccess = Record<Module, AccessLevel>;

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: 'Dashboard',
  cycles: 'Cycles',
  people: 'People',
  talents: 'Org structure',
  assignments: 'Assignments',
  users: 'Users',
  audit: 'Audit trail',
  settings: 'Settings',
};

export function fullAccess(): ModuleAccess {
  return Object.fromEntries(MODULES.map((module) => [module, 2])) as ModuleAccess;
}

export function noAccess(): ModuleAccess {
  return Object.fromEntries(MODULES.map((module) => [module, 0])) as ModuleAccess;
}

export function canView(profile: Profile, module: Module): boolean {
  return profile.modules[module] >= 1;
}

export function canEdit(profile: Profile, module: Module): boolean {
  return profile.modules[module] >= 2;
}

/** Workspace modules (Settings lives behind the Notifications button instead). */
export function hasWorkspaceAccess(profile: Profile): boolean {
  return MODULES.some((module) => module !== 'settings' && canView(profile, module));
}
