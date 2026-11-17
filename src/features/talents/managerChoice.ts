import type { ProfileRef } from '@/lib/records';

export type ManagerChoice = { ids: string[]; primaryId: string | null };

export const EMPTY_MANAGER_CHOICE: ManagerChoice = { ids: [], primaryId: null };

export function toggleManager(choice: ManagerChoice, id: string): ManagerChoice {
  if (choice.ids.includes(id)) {
    const ids = choice.ids.filter((item) => item !== id);
    const primaryId = choice.primaryId === id ? (ids[0] ?? null) : choice.primaryId;
    return { ids, primaryId };
  }
  return { ids: [...choice.ids, id], primaryId: choice.primaryId ?? id };
}

export function setPrimaryManager(choice: ManagerChoice, id: string): ManagerChoice {
  return choice.ids.includes(id) ? { ...choice, primaryId: id } : choice;
}

export function candidateManagers(people: ProfileRef[], excludeId: string | null): ProfileRef[] {
  return people.filter((person) => person.id !== excludeId);
}
