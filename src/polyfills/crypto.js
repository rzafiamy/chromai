// Shim for Node.js crypto.randomUUID used by lemura internals
export const randomUUID = () => globalThis.crypto.randomUUID();
export default { randomUUID };
