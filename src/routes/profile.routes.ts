import type { FastifyInstance } from 'fastify';
import * as profileService from '../services/profile.service.js';
import {
  UpdateProfileSectionSchema,
  AddProfileEntrySchema,
  UpdateProfileEntrySchema,
} from '../types/index.types.js';

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async () => {
    return profileService.getProfile();
  });

  app.get('/api/profile/sections/:sectionId', async request => {
    const { sectionId } = request.params as { sectionId: string };
    return profileService.getSection(sectionId);
  });

  app.patch('/api/profile/sections/:sectionId', async request => {
    const { sectionId } = request.params as { sectionId: string };
    const parsed = UpdateProfileSectionSchema.parse(request.body);
    return profileService.updateSection(sectionId, parsed);
  });

  app.post('/api/profile/sections/:sectionId/entries', async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const parsed = AddProfileEntrySchema.parse(request.body);
    const entry = await profileService.addEntry(sectionId, parsed);
    return reply.status(201).send(entry);
  });

  app.patch('/api/profile/entries/:entryId', async request => {
    const { entryId } = request.params as { entryId: string };
    const parsed = UpdateProfileEntrySchema.parse(request.body);
    return profileService.updateEntry(entryId, parsed);
  });

  app.delete('/api/profile/entries/:entryId', async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    await profileService.deleteEntry(entryId);
    return reply.status(204).send();
  });
}
