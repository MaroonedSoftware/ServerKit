import { describe, expect, it } from 'vitest';
import { johnnyPaths, projectSlug } from '../src/util/paths.js';

describe('projectSlug', () => {
    it('combines basename with an 8-char hex hash', () => {
        const slug = projectSlug('/Users/me/projects/my_app');
        expect(slug).toMatch(/^my_app-[a-f0-9]{8}$/);
    });

    it('produces the same slug for the same absolute path', () => {
        expect(projectSlug('/Users/me/code/x')).toBe(projectSlug('/Users/me/code/x'));
    });

    it('produces different slugs for different absolute paths with the same basename', () => {
        const a = projectSlug('/a/project');
        const b = projectSlug('/b/project');
        expect(a).not.toBe(b);
        expect(a.startsWith('project-')).toBe(true);
        expect(b.startsWith('project-')).toBe(true);
    });

    it('sanitises basenames that contain unsafe characters', () => {
        const slug = projectSlug('/tmp/has space');
        expect(slug).toMatch(/^has_space-[a-f0-9]{8}$/);
    });
});

describe('johnnyPaths', () => {
    it('returns absolute paths for log, runtime, and cache', () => {
        const paths = johnnyPaths('test-app');
        expect(paths.log.startsWith('/')).toBe(true);
        expect(paths.runtime.startsWith('/')).toBe(true);
        expect(paths.cache.startsWith('/')).toBe(true);
    });

    it('includes the app name in each path', () => {
        const paths = johnnyPaths('demo-app');
        expect(paths.log).toContain('demo-app');
        expect(paths.runtime).toContain('demo-app');
        expect(paths.cache).toContain('demo-app');
    });
});
