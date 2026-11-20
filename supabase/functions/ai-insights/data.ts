// Data preparation for the AI features: scores, anonymised notes and pseudonyms. Nothing here calls Claude.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

type Admin = SupabaseClient;

export type Competency = { id: string; sort_order: number; category: string; name: string; definition: string };

export const GROUPS = ["Self", "Managers", "Peers", "Direct reports", "External"] as const;
export type Group = (typeof GROUPS)[number];

export function groupOf(classification: string): Group {
  if (classification === "self") return "Self";
  if (classification === "immediate_manager" || classification === "skip_level_manager") return "Managers";
  if (classification === "direct_report" || classification === "skip_level_report") return "Direct reports";
  if (classification === "external") return "External";
  return "Peers";
}

export async function loadCompetencies(admin: Admin): Promise<Competency[]> {
  const { data, error } = await admin.from("competencies").select("id, sort_order, category, name, definition").order("sort_order");
  if (error) throw new Error(`Could not load competencies: ${error.message}`);
  return (data ?? []) as Competency[];
}

export type Answer = { talentId: string; group: Group; competencyId: string; rating: number; note: string };

/** Every submitted answer in a cycle, optionally for some people only. */
export async function loadAnswers(admin: Admin, cycleId: string, talentIds?: string[]): Promise<Answer[]> {
  let query = admin.from("assignments").select("id, talent_id, classification").eq("cycle_id", cycleId).eq("status", "submitted");
  if (talentIds) query = query.in("talent_id", talentIds);
  const { data: assignments, error } = await query;
  if (error) throw new Error(`Could not load evaluations: ${error.message}`);
  const byId = new Map(((assignments ?? []) as { id: string; talent_id: string; classification: string }[]).map((a) => [a.id, a]));
  const ids = [...byId.keys()];
  const answers: Answer[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: responseError } = await admin
      .from("responses")
      .select("assignment_id, competency_id, rating, behaviour_note")
      .in("assignment_id", ids.slice(i, i + 200));
    if (responseError) throw new Error(`Could not load answers: ${responseError.message}`);
    for (const row of (data ?? []) as { assignment_id: string; competency_id: string; rating: number; behaviour_note: string }[]) {
      const a = byId.get(row.assignment_id);
      if (!a) continue;
      answers.push({ talentId: a.talent_id, group: groupOf(a.classification), competencyId: row.competency_id, rating: row.rating, note: row.behaviour_note });
    }
  }
  return answers;
}

const round = (n: number) => Math.round(n * 100) / 100;
function avg(values: number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((a, b) => a + b, 0) / values.length);
}

export type CompetencyScore = { competency: string; category: string; self: number | null; others: number | null; byGroup: Partial<Record<Group, number>> };

/** Average ratings per competency: self, everyone else, and per rater group. */
export function scoreCompetencies(answers: Answer[], competencies: Competency[]): CompetencyScore[] {
  return competencies.map((c) => {
    const rows = answers.filter((a) => a.competencyId === c.id);
    const byGroup: Partial<Record<Group, number>> = {};
    for (const g of GROUPS) {
      const value = avg(rows.filter((r) => r.group === g).map((r) => r.rating));
      if (value !== null) byGroup[g] = value;
    }
    return {
      competency: c.name,
      category: c.category,
      self: avg(rows.filter((r) => r.group === "Self").map((r) => r.rating)),
      others: avg(rows.filter((r) => r.group !== "Self").map((r) => r.rating)),
      byGroup,
    };
  });
}

export function overall(scores: CompetencyScore[]): { others: number | null; self: number | null } {
  return {
    others: avg(scores.map((s) => s.others).filter((v): v is number => v !== null)),
    self: avg(scores.map((s) => s.self).filter((v): v is number => v !== null)),
  };
}

/**
 * Removes the names of everyone in the system from free text before it goes to the AI service: full names, and
 * first or last names of three letters or more.
 */
export async function nameScrubber(admin: Admin): Promise<(text: string) => string> {
  const { data } = await admin.from("profiles").select("full_name");
  const words = new Set<string>();
  for (const row of (data ?? []) as { full_name: string }[]) {
    const name = row.full_name?.trim();
    if (!name || name.startsWith("Deleted person")) continue;
    words.add(name);
    for (const part of name.split(/\s+/)) if (part.length >= 3) words.add(part);
  }
  const escaped = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return (text) => text;
  const pattern = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
  return (text) => text.replace(pattern, "[name]");
}

/** Stable codes like [P3] stand in for people; the answer is translated back to names after Claude replies. */
export class Pseudonyms {
  private codeById = new Map<string, string>();
  private nameByCode = new Map<string, string>();

  code(id: string, name: string): string {
    let code = this.codeById.get(id);
    if (!code) {
      code = `[P${this.codeById.size + 1}]`;
      this.codeById.set(id, code);
      this.nameByCode.set(code, name);
    }
    return code;
  }

  /** Replaces codes in every string of a JSON value. */
  restore<T>(value: T): T {
    const swap = (text: string) => text.replace(/\[P\d+\]/g, (code) => this.nameByCode.get(code) ?? code);
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") return swap(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    return walk(value) as T;
  }
}

export type Person = { talentId: string; profileId: string; name: string; department: string | null; position: string | null; outside: boolean; groups: string[] };

export async function loadPeople(admin: Admin): Promise<Map<string, Person>> {
  const [talents, members, groups] = await Promise.all([
    admin.from("talents").select("id, profile_id, profile:profiles!profile_id(full_name, department, position, person_type)"),
    admin.from("user_group_members").select("group_id, profile_id"),
    admin.from("user_groups").select("id, name"),
  ]);
  const groupName = new Map(((groups.data ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name]));
  const groupsOf = new Map<string, string[]>();
  for (const m of (members.data ?? []) as { group_id: string; profile_id: string }[]) {
    const name = groupName.get(m.group_id);
    if (name) groupsOf.set(m.profile_id, [...(groupsOf.get(m.profile_id) ?? []), name]);
  }
  const people = new Map<string, Person>();
  type Row = { id: string; profile_id: string; profile: { full_name: string; department: string | null; position: string | null; person_type: string } | null };
  for (const t of (talents.data ?? []) as unknown as Row[]) {
    if (!t.profile) continue;
    people.set(t.id, {
      talentId: t.id,
      profileId: t.profile_id,
      name: t.profile.full_name,
      department: t.profile.department,
      position: t.profile.position,
      outside: t.profile.person_type === "external",
      groups: groupsOf.get(t.profile_id) ?? [],
    });
  }
  return people;
}

/** Spreads a long list evenly instead of keeping only the first items. */
export function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]);
}
