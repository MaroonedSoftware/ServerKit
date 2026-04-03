export const nullToUndefined = <T = object>(obj: object): T => {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === null ? undefined : v])) as T;
};
