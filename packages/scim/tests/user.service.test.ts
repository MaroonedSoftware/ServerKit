import { describe, expect, it } from 'vitest';
import { ScimUserService } from '../src/services/scim.user.service.js';
import { UserSchemaId } from '../src/schemas/user.schema.js';
import { EnterpriseUserSchemaId } from '../src/schemas/enterprise.user.schema.js';
import { InMemoryUserRepository, silentLogger } from './in.memory.repos.js';
import { IsScimError } from '../src/errors/scim.error.js';

const makeService = () => {
  const repo = new InMemoryUserRepository();
  const service = new ScimUserService(repo, silentLogger);
  return { repo, service };
};

describe('ScimUserService', () => {
  it('assigns id, schemas, and meta on create', async () => {
    const { service } = makeService();
    const user = await service.create({ userName: 'bjensen' });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.schemas).toContain(UserSchemaId);
    expect(user.meta.resourceType).toBe('User');
    expect(user.meta.created).toEqual(user.meta.lastModified);
    expect(user.meta.location).toBe(`/Users/${user.id}`);
  });

  it('adds the EnterpriseUser schema URN when the extension is present', async () => {
    const { service } = makeService();
    const user = await service.create({
      userName: 'bjensen',
      [EnterpriseUserSchemaId]: { employeeNumber: '4242' },
    });
    expect(user.schemas).toEqual(expect.arrayContaining([UserSchemaId, EnterpriseUserSchemaId]));
  });

  it('rejects duplicate userName with a 409 uniqueness error', async () => {
    const { service } = makeService();
    await service.create({ userName: 'bjensen' });
    try {
      await service.create({ userName: 'bjensen' });
      expect.fail('expected uniqueness error');
    } catch (error) {
      expect(IsScimError(error)).toBe(true);
      if (IsScimError(error)) {
        expect(error.statusCode).toBe(409);
        expect(error.scimType).toBe('uniqueness');
      }
    }
  });

  it('replace preserves id and created, updates lastModified', async () => {
    const { service } = makeService();
    const created = await service.create({ userName: 'bjensen' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const replaced = await service.replace(created.id, { userName: 'bjensen', displayName: 'Barbara' });
    expect(replaced.id).toBe(created.id);
    expect(replaced.meta.created).toBe(created.meta.created);
    expect(replaced.meta.lastModified).not.toBe(created.meta.lastModified);
    expect(replaced.displayName).toBe('Barbara');
  });

  it('patch applies SCIM ops', async () => {
    const { service } = makeService();
    const created = await service.create({ userName: 'bjensen', displayName: 'Barb' });
    const patched = await service.patch(created.id, [
      { op: 'replace', path: 'displayName', value: 'Barbara' },
      { op: 'add', path: 'title', value: 'Engineer' },
    ]);
    expect(patched.displayName).toBe('Barbara');
    expect(patched.title).toBe('Engineer');
    expect(patched.id).toBe(created.id);
  });

  it('delete removes the user', async () => {
    const { service, repo } = makeService();
    const created = await service.create({ userName: 'bjensen' });
    await service.delete(created.id);
    expect(repo.users.has(created.id)).toBe(false);
  });

  it('get throws 404 when missing', async () => {
    const { service } = makeService();
    await expect(service.get('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
