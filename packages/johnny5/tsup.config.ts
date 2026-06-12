import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'bin.shim': 'src/bin.shim.ts',
        'integrations/serverkit/index': 'src/integrations/serverkit/index.ts',
        'integrations/postgres/index': 'src/integrations/postgres/index.ts',
        'integrations/redis/index': 'src/integrations/redis/index.ts',
        'integrations/docker/index': 'src/integrations/docker/index.ts',
        'integrations/versions/index': 'src/integrations/versions/index.ts',
        'integrations/filesystem/index': 'src/integrations/filesystem/index.ts',
        'integrations/kysely/index': 'src/integrations/kysely/index.ts',
        'integrations/permissions/index': 'src/integrations/permissions/index.ts',
        'integrations/keyring/index': 'src/integrations/keyring/index.ts',
    },
    format: ['esm'],
    target: 'node22',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
});
