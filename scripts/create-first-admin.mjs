import { createClient } from '@supabase/supabase-js';

const MIN_PASSWORD_LENGTH = 8;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const fullName = process.env.ADMIN_FULL_NAME?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
}
if (!email || !fullName || !password) {
  fail('ADMIN_EMAIL, ADMIN_FULL_NAME and ADMIN_PASSWORD must all be set.');
}
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { count, error: countError } = await admin
  .from('profiles')
  .select('id', { count: 'exact', head: true })
  .eq('role', 'admin');
if (countError) {
  fail(`Could not check for existing admins: ${countError.message}`);
}
if (count > 0) {
  fail('An admin account already exists. Nothing was changed.');
}

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createError || !created.user) {
  fail(`Could not create the login account: ${createError?.message ?? 'unknown error'}`);
}

const { error: profileError } = await admin.from('profiles').insert({
  id: created.user.id,
  full_name: fullName,
  email,
  role: 'admin',
  must_change_password: true,
});
if (profileError) {
  await admin.auth.admin.deleteUser(created.user.id);
  fail(`Could not create the admin profile: ${profileError.message}`);
}

console.log(`Admin account created for ${email}. They will be asked to choose a new password at first sign-in.`);
