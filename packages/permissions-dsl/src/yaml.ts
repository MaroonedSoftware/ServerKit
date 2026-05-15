/**
 * Thin re-export of the `yaml` package's `parse`/`stringify` helpers. Lets
 * consumers (the VSCode extension's playground in particular) reach YAML I/O
 * without adding a direct `yaml` dependency, since `permissions-dsl`
 * already bundles it for fixture loading.
 */
export { parse as yamlParse, stringify as yamlStringify } from 'yaml';
