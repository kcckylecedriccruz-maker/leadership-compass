export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

const PERMISSION_MESSAGE = 'You do not have permission to make this change.';
const SHOWN_ERROR_CODES = new Set(['P0001', 'P0002', '22023']);

export function databaseErrorMessage(error: unknown): string {
  const { code, message } = readErrorFields(error);
  if (code === '42501') return PERMISSION_MESSAGE;
  if (code && message && SHOWN_ERROR_CODES.has(code)) return message;
  return GENERIC_ERROR_MESSAGE;
}

function readErrorFields(error: unknown): { code?: string; message?: string } {
  if (typeof error !== 'object' || error === null) return {};
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  };
}
