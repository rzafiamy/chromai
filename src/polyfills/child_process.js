// Stub for Node.js child_process — used by lemura's MCP stdio transport.
// In the browser/extension context, MCP stdio is not available.
export const spawn = () => {
  throw new Error('child_process.spawn is not available in the browser extension context');
};
export default { spawn };
