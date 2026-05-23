// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown;

const warned = new Set<string>();

const warn = (fqName: string): void => {
  if (warned.has(fqName)) return;
  warned.add(fqName);
  console.warn(
    `[@maroonedsoftware/utilities] ${fqName} already exists; skipping extension install. ` +
      `Calls to ${fqName} will use the existing implementation, which may differ in semantics from this package.`,
  );
};

export const installArrayMethod = (name: string, value: AnyFn): void => {
  if (Object.prototype.hasOwnProperty.call(Array.prototype, name)) {
    warn(`Array.prototype.${name}`);
    return;
  }
  Object.defineProperty(Array.prototype, name, { value, enumerable: false, writable: true, configurable: true });
};

export const installStringMethod = (name: string, value: AnyFn): void => {
  if (Object.prototype.hasOwnProperty.call(String.prototype, name)) {
    warn(`String.prototype.${name}`);
    return;
  }
  Object.defineProperty(String.prototype, name, { value, enumerable: false, writable: true, configurable: true });
};
