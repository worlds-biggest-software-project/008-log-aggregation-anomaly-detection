#!/usr/bin/env node

const command = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  ingest: async () => {
    console.log('logwatch ingest: ship logs from stdin (not yet implemented)');
  },
  query: async () => {
    console.log('logwatch query: search logs (not yet implemented)');
  },
  'api-key': async () => {
    console.log('logwatch api-key: manage API keys (not yet implemented)');
  },
};

async function main() {
  if (!command || command === '--help') {
    console.log('Usage: logwatch <command>\n');
    console.log('Commands:');
    console.log('  ingest     Ship logs from stdin');
    console.log('  query      Search logs');
    console.log('  api-key    Manage API keys');
    process.exit(0);
  }

  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  await handler();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
