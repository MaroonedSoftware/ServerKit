import { describe, it, expect } from 'vitest';
import { CamelCasePlugin } from 'kysely';
import { KyselyDefaultPlugins } from '../src/kysely.default.plugins.js';
import { NullToUndefinedPlugin } from '../src/plugins/null.to.undefined.plugin.js';
import { DateTimeParameterPlugin } from '../src/plugins/datetime.parameter.plugin.js';

describe('KyselyDefaultPlugins', () => {
  it('should be an array', () => {
    expect(Array.isArray(KyselyDefaultPlugins)).toBe(true);
  });

  it('should contain exactly three plugins', () => {
    expect(KyselyDefaultPlugins).toHaveLength(3);
  });

  it('should have CamelCasePlugin as the first plugin', () => {
    expect(KyselyDefaultPlugins[0]).toBeInstanceOf(CamelCasePlugin);
  });

  it('should have NullToUndefinedPlugin as the second plugin', () => {
    expect(KyselyDefaultPlugins[1]).toBeInstanceOf(NullToUndefinedPlugin);
  });

  it('should have DateTimeParameterPlugin as the third plugin', () => {
    expect(KyselyDefaultPlugins[2]).toBeInstanceOf(DateTimeParameterPlugin);
  });

  it('each plugin should implement the KyselyPlugin interface', () => {
    for (const plugin of KyselyDefaultPlugins) {
      expect(typeof plugin.transformQuery).toBe('function');
      expect(typeof plugin.transformResult).toBe('function');
    }
  });
});
