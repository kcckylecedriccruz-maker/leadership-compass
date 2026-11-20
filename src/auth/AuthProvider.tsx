import { createContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { MODULES, fullAccess, isRole, noAccess, type AccessLevel, type ModuleAccess, type Profile } from '@/lib/types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'error'; message: string }
  | { status: 'signed_in'; profile: Profile };

export type AuthContextValue = {
  state: AuthState;
  signInNotice: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<string | null>;
  markTourSeen: () => Promise<void>;
  /** Reflects a saved change (e.g. on My profile) without reloading. */
  updateProfileLocally: (patch: Partial<Profile>) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

const EXPIRED_TEMPORARY_PASSWORD_MESSAGE = 'Your temporary password has expired. Request a new one.';
// Zero-width spaces, joiners, byte-order marks and non-breaking spaces that copy-paste can add.
const INVISIBLE_CHARACTERS = new RegExp("[\u200B-\u200D\u2060\uFEFF\u00A0]", "g");
const DEACTIVATED_MESSAGE ='This account has been deactivated. Contact your administrator if you need access.';

type ProfileResult = { profile: Profile } | { error: string };

// Admins have every module; others get what an admin granted in module_access.
async function fetchModuleAccess(userId: string, role: string): Promise<ModuleAccess | null> {
  if (role === 'admin') return fullAccess();
  const { data, error } = await supabase.from('module_access').select('module, level').eq('profile_id', userId);
  // Before the module-access migration the table does not exist: treat as no extra access.
  if (error) return error.code === '42P01' ? noAccess() : null;
  const access = noAccess();
  for (const row of (data ?? []) as { module: string; level: string }[]) {
    if ((MODULES as readonly string[]).includes(row.module)) {
      access[row.module as keyof ModuleAccess] = (row.level === 'edit' ? 2 : 1) as AccessLevel;
    }
  }
  return access;
}

async function fetchProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { error: 'We could not load your account. Please try again.' };
  }
  if (!data || !isRole(data.role)) {
    return { error: 'Your account is not set up yet. Please contact your administrator.' };
  }
  const [managed, talentRow, modules] = await Promise.all([
    supabase.from('talent_managers').select('talent_id', { count: 'exact', head: true }).eq('manager_profile_id', userId),
    supabase.from('talents').select('id', { count: 'exact', head: true }).eq('profile_id', userId),
    fetchModuleAccess(userId, data.role),
  ]);
  if (managed.error || talentRow.error || !modules) {
    return { error: 'We could not load your account. Please try again.' };
  }
  return {
    profile: {
      id: data.id,
      full_name: data.full_name,
      email: data.email,
      role: data.role,
      manages_talents: (managed.count ?? 0) > 0,
      is_talent: (talentRow.count ?? 0) > 0,
      must_change_password: data.must_change_password,
      temp_password_expires_at: data.temp_password_expires_at,
      tour_seen_at: data.tour_seen_at,
      // Older databases without the user-control migration have no is_active column.
      is_active: data.is_active !== false,
      modules,
    },
  };
}

function temporaryPasswordExpired(profile: Profile): boolean {
  return (
    profile.must_change_password &&
    profile.temp_password_expires_at !== null &&
    Date.parse(profile.temp_password_expires_at) <= Date.now()
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [signInNotice, setSignInNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (event === 'SIGNED_OUT' || !session) {
          setState({ status: 'signed_out' });
          return;
        }
        if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') return;

        setState((prev) =>
          prev.status === 'signed_in' && prev.profile.id === session.user.id ? prev : { status: 'loading' },
        );
        const result = await fetchProfile(session.user.id);
        if (!('profile' in result)) {
          setState({ status: 'error', message: result.error });
          return;
        }
        if (!result.profile.is_active) {
          setSignInNotice(DEACTIVATED_MESSAGE);
          await supabase.auth.signOut();
          return;
        }
        if (temporaryPasswordExpired(result.profile)) {
          setSignInNotice(EXPIRED_TEMPORARY_PASSWORD_MESSAGE);
          await supabase.auth.signOut();
          return;
        }
        setSignInNotice(null);
        setState({ status: 'signed_in', profile: result.profile });
      })();
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    setSignInNotice(null);
    const cleanEmail = email.replace(INVISIBLE_CHARACTERS, '').trim();
    let { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    // A password copied from an email often brings a space, line break or invisible character
    // with it. Generated temporary passwords never contain those, so retry once without them.
    const cleanPassword = password.replace(INVISIBLE_CHARACTERS, '').trim();
    if (error && cleanPassword !== password && cleanPassword.length > 0) {
      ({ error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword }));
    }
    if (error) {
      if (error.message.toLowerCase().includes('banned')) return DEACTIVATED_MESSAGE;
      return error.message.toLowerCase().includes('invalid login')
        ? 'That email and password do not match. Please try again.'
        : 'We could not sign you in. Check your connection and try again.';
    }
    return null;
  }

  async function signOut(): Promise<void> {
    // Best effort: the audit trail records the sign-out; never block signing out on it.
    await supabase.rpc('record_audit_event', { p_action: 'auth.sign_out' }).then(
      ({ error }) => error && console.warn('Could not record sign-out in the audit trail', error.message),
      () => undefined,
    );
    await supabase.auth.signOut();
  }

  async function changePassword(newPassword: string): Promise<string | null> {
    const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
    if (passwordError) {
      const code = (passwordError as { code?: string }).code ?? '';
      if (code === 'same_password' || /different from the old/i.test(passwordError.message)) {
        return 'Choose a new password that is different from your temporary password.';
      }
      if (code === 'weak_password' || /password/i.test(passwordError.message)) {
        return `Your new password was not accepted: ${passwordError.message}`;
      }
      return 'We could not update your password. Please try again.';
    }
    const { error: flagError } = await supabase.rpc('complete_password_change');
    if (flagError) {
      return 'Your password was changed, but we could not finish setup. Please try again.';
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      return 'Your session has expired. Please sign in again.';
    }
    const result = await fetchProfile(userId);
    if (!('profile' in result)) {
      return 'Your password was changed, but we could not load your account. Please refresh the page.';
    }
    setState({ status: 'signed_in', profile: result.profile });
    return null;
  }

  async function markTourSeen(): Promise<void> {
    const { error } = await supabase.rpc('mark_tour_seen');
    if (error) {
      console.error('Could not record the welcome tour', error);
      return;
    }
    setState((prev) =>
      prev.status === 'signed_in'
        ? { status: 'signed_in', profile: { ...prev.profile, tour_seen_at: new Date().toISOString() } }
        : prev,
    );
  }

  function updateProfileLocally(patch: Partial<Profile>) {
    setState((prev) => (prev.status === 'signed_in' ? { status: 'signed_in', profile: { ...prev.profile, ...patch } } : prev));
  }

  return (
    <AuthContext.Provider
      value={{
        state,
        signInNotice,
        signIn,
        signOut,
        changePassword,
        markTourSeen,
        updateProfileLocally,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
