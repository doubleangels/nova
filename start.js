const http = require('http');
const { spawn } = require('child_process');

// Simple HTTP server for Cloud Run health checks
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

// Start the HTTP server on the port specified by Cloud Run
const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});

// Start the Discord bot
console.log('Starting Discord bot...');
const bot = spawn('node', ['index.js'], {
  stdio: 'inherit',
  cwd: process.cwd()
});

// Handle bot process events
bot.on('error', (error) => {
  console.error('Failed to start Discord bot:', error);
  process.exit(1);
});

bot.on('exit', (code) => {
  console.log(`Discord bot exited with code ${code}`);
  if (code !== 0) {
    process.exit(code);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  bot.kill('SIGTERM');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  bot.kill('SIGINT');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
