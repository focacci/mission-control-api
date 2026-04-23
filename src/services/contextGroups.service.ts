import { asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { contextGroups, contextGroupMembers, pinnedContexts } from '../db/schema.js';
import {
  now,
  notFound,
  type CreatePinnedContextInput,
  type CreateContextGroupInput,
  type UpdateContextGroupInput,
  type AddContextGroupMemberInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Pinned contexts
// ---------------------------------------------------------------------------

export async function listPinnedContexts() {
  return db
    .select()
    .from(pinnedContexts)
    .orderBy(asc(pinnedContexts.sortOrder), asc(pinnedContexts.createdAt));
}

export async function createPinnedContext(input: CreatePinnedContextInput) {
  const row = {
    id: nanoid(),
    contextType: input.contextType,
    contextId: input.contextId ?? null,
    label: input.label,
    icon: input.icon,
    typeName: input.typeName,
    payload: input.payload ?? null,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now(),
  };
  await db.insert(pinnedContexts).values(row);
  return row;
}

export async function deletePinnedContext(id: string) {
  const [existing] = await db
    .select()
    .from(pinnedContexts)
    .where(eq(pinnedContexts.id, id));
  if (!existing) throw notFound('PinnedContext', id);
  await db.delete(pinnedContexts).where(eq(pinnedContexts.id, id));
}

// ---------------------------------------------------------------------------
// Context groups
// ---------------------------------------------------------------------------

async function loadMembers(groupIds: string[]) {
  if (groupIds.length === 0) return new Map<string, any[]>();
  const rows = await db.select().from(contextGroupMembers);
  const byGroup = new Map<string, typeof rows>();
  for (const m of rows) {
    if (!groupIds.includes(m.groupId)) continue;
    const arr = byGroup.get(m.groupId) ?? [];
    arr.push(m);
    byGroup.set(m.groupId, arr);
  }
  for (const [k, arr] of byGroup) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
    byGroup.set(k, arr);
  }
  return byGroup;
}

export async function listContextGroups() {
  const groups = await db
    .select()
    .from(contextGroups)
    .orderBy(asc(contextGroups.sortOrder), asc(contextGroups.createdAt));
  const memberMap = await loadMembers(groups.map(g => g.id));
  return groups.map(g => ({ ...g, members: memberMap.get(g.id) ?? [] }));
}

export async function getContextGroup(id: string) {
  const [group] = await db.select().from(contextGroups).where(eq(contextGroups.id, id));
  if (!group) throw notFound('ContextGroup', id);
  const members = await db
    .select()
    .from(contextGroupMembers)
    .where(eq(contextGroupMembers.groupId, id))
    .orderBy(asc(contextGroupMembers.sortOrder));
  return { ...group, members };
}

export async function createContextGroup(input: CreateContextGroupInput) {
  const id = nanoid();
  const timestamp = now();
  const group = {
    id,
    name: input.name,
    icon: input.icon ?? 'point.3.connected.trianglepath.dotted',
    summary: input.summary ?? null,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const memberRows =
    input.members?.map((m, idx) => ({
      id: nanoid(),
      groupId: id,
      contextType: m.contextType,
      contextId: m.contextId ?? null,
      label: m.label,
      icon: m.icon,
      typeName: m.typeName,
      payload: m.payload ?? null,
      sortOrder: m.sortOrder ?? idx,
    })) ?? [];

  db.transaction(tx => {
    tx.insert(contextGroups).values(group).run();
    for (const m of memberRows) tx.insert(contextGroupMembers).values(m).run();
  });

  return { ...group, members: memberRows };
}

export async function updateContextGroup(id: string, input: UpdateContextGroupInput) {
  const [existing] = await db.select().from(contextGroups).where(eq(contextGroups.id, id));
  if (!existing) throw notFound('ContextGroup', id);

  const updates: Partial<typeof existing> = { updatedAt: now() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.icon !== undefined) updates.icon = input.icon;
  if ('summary' in input) updates.summary = input.summary ?? null;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(contextGroups).set(updates).where(eq(contextGroups.id, id));
  const [updated] = await db.select().from(contextGroups).where(eq(contextGroups.id, id));
  return updated;
}

export async function deleteContextGroup(id: string) {
  const [existing] = await db.select().from(contextGroups).where(eq(contextGroups.id, id));
  if (!existing) throw notFound('ContextGroup', id);
  db.transaction(tx => {
    tx.delete(contextGroupMembers).where(eq(contextGroupMembers.groupId, id)).run();
    tx.delete(contextGroups).where(eq(contextGroups.id, id)).run();
  });
}

export async function addContextGroupMember(
  groupId: string,
  input: AddContextGroupMemberInput,
) {
  const [group] = await db.select().from(contextGroups).where(eq(contextGroups.id, groupId));
  if (!group) throw notFound('ContextGroup', groupId);

  const row = {
    id: nanoid(),
    groupId,
    contextType: input.contextType,
    contextId: input.contextId ?? null,
    label: input.label,
    icon: input.icon,
    typeName: input.typeName,
    payload: input.payload ?? null,
    sortOrder: input.sortOrder ?? 0,
  };
  await db.insert(contextGroupMembers).values(row);
  await db
    .update(contextGroups)
    .set({ updatedAt: now() })
    .where(eq(contextGroups.id, groupId));
  return row;
}

export async function removeContextGroupMember(groupId: string, memberId: string) {
  const [existing] = await db
    .select()
    .from(contextGroupMembers)
    .where(eq(contextGroupMembers.id, memberId));
  if (!existing || existing.groupId !== groupId) {
    throw notFound('ContextGroupMember', memberId);
  }
  await db.delete(contextGroupMembers).where(eq(contextGroupMembers.id, memberId));
  await db
    .update(contextGroups)
    .set({ updatedAt: now() })
    .where(eq(contextGroups.id, groupId));
}
