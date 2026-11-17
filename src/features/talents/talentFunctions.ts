import { callEdgeFunction, isRecord, type FunctionResult } from '@/lib/edgeFunctions';

type TalentIdentity = { talent_profile_id: string } | { full_name: string; email: string };

export type CreateTalentBody = TalentIdentity & {
  department: string | null;
  position: string | null;
  manager_ids: string[];
  primary_manager_id: string | null;
  new_manager: { full_name: string; email: string } | null;
};

export type CreatedAccount = {
  full_name: string;
  email: string;
  role: string;
  temporary_password: string;
};

export type CreateTalentResult = {
  talent_id: string;
  existing_person: boolean;
  self_cycles: string[];
  talent_email_sent: boolean | null;
  failed_cycles: string[];
  accounts: CreatedAccount[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCreatedAccount(value: unknown): value is CreatedAccount {
  return (
    isRecord(value) &&
    typeof value.full_name === 'string' &&
    typeof value.email === 'string' &&
    typeof value.role === 'string' &&
    typeof value.temporary_password === 'string'
  );
}

function isCreateTalentResult(value: unknown): value is CreateTalentResult {
  return (
    isRecord(value) &&
    typeof value.talent_id === 'string' &&
    typeof value.existing_person === 'boolean' &&
    isStringArray(value.self_cycles) &&
    (value.talent_email_sent === null || typeof value.talent_email_sent === 'boolean') &&
    isStringArray(value.failed_cycles) &&
    Array.isArray(value.accounts) &&
    value.accounts.every(isCreatedAccount)
  );
}

export function createTalent(body: CreateTalentBody): Promise<FunctionResult<CreateTalentResult>> {
  return callEdgeFunction('create-talent', body, isCreateTalentResult);
}

export type BulkTalentRequest = { profile_id: string; manager_ids: string[]; primary_manager_id: string | null };

export type BulkAddedTalent = {
  profile_id: string;
  full_name: string;
  talent_id: string;
  manager_needed: boolean;
  self_cycles: string[];
  failed_cycles: string[];
  email_sent: boolean;
};

export type BulkTalentResult = {
  added: BulkAddedTalent[];
  skipped: { profile_id: string; full_name: string }[];
  failed: { profile_id: string; full_name: string; message: string }[];
};

function isBulkAddedTalent(value: unknown): value is BulkAddedTalent {
  return (
    isRecord(value) &&
    typeof value.profile_id === 'string' &&
    typeof value.full_name === 'string' &&
    typeof value.talent_id === 'string' &&
    typeof value.manager_needed === 'boolean' &&
    isStringArray(value.self_cycles) &&
    isStringArray(value.failed_cycles) &&
    typeof value.email_sent === 'boolean'
  );
}

function isNamedPerson(value: unknown): value is { profile_id: string; full_name: string } {
  return isRecord(value) && typeof value.profile_id === 'string' && typeof value.full_name === 'string';
}

function isFailedPerson(value: unknown): value is { profile_id: string; full_name: string; message: string } {
  return isNamedPerson(value) && typeof (value as { message?: unknown }).message === 'string';
}

function isBulkTalentResult(value: unknown): value is BulkTalentResult {
  return (
    isRecord(value) &&
    Array.isArray(value.added) &&
    value.added.every(isBulkAddedTalent) &&
    Array.isArray(value.skipped) &&
    value.skipped.every(isNamedPerson) &&
    Array.isArray(value.failed) &&
    value.failed.every(isFailedPerson)
  );
}

export function addExistingTalents(people: BulkTalentRequest[]): Promise<FunctionResult<BulkTalentResult>> {
  return callEdgeFunction('add-existing-talents', { people }, isBulkTalentResult);
}
