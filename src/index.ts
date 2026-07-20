import { loadWorkspaceConfig } from './config/workspace-config.js';
import { toStructuredError } from './errors/workspace-error.js';
import { startStdioServer } from './mcp/server.js';
import { SERVER_NAME, SERVER_VERSION } from './services/foundation-service.js';

async function main(): Promise<void> {
  const config = await loadWorkspaceConfig();
  await startStdioServer(config);
  process.stderr.write(SERVER_NAME + ' ' + SERVER_VERSION + ' is running on stdio.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(JSON.stringify(toStructuredError(error)) + '\n');
  process.exitCode = 1;
});
