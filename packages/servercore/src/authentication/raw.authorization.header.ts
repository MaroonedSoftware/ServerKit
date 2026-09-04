/** The header both adapters resolve and then remove from the request. */
const AUTHORIZATION = 'authorization';

/**
 * Removes every `Authorization` entry from a Node `rawHeaders` array, in place.
 *
 * `IncomingMessage.rawHeaders` is populated separately from `IncomingMessage.headers`
 * at parse time and is not kept in sync with it, so `delete req.headers.authorization`
 * leaves the credential sitting in `req.rawHeaders`. Anything that serializes the raw
 * array — a request logger, an error reporter, a proxy that replays headers — would
 * still capture it. Both adapters' authentication step calls this alongside the
 * `headers` delete so the credential is gone from every view of the request.
 *
 * The array is flat (`[name, value, name, value, …]`), so only even indices are names:
 * a header whose *value* happens to be `"authorization"` is left alone. Duplicated
 * `Authorization` headers are all removed. Mutates in place rather than reassigning,
 * so a reference taken before the call sees the removal too.
 *
 * @param rawHeaders - The `rawHeaders` array to strip; safe to call on an empty one.
 */
export const stripRawAuthorizationHeader = (rawHeaders: string[]): void => {
  let index = 0;

  // `length - 1` so a name always has its value alongside it. On a match the
  // following pair shifts down into `index`, so only the else branch advances.
  while (index < rawHeaders.length - 1) {
    if (rawHeaders[index]?.toLowerCase() === AUTHORIZATION) {
      rawHeaders.splice(index, 2);
    } else {
      index += 2;
    }
  }
};
