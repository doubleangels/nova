# Security Hardening Quick Start Guide

## 🚀 Quick Implementation (5 minutes)

### Step 1: Update docker-compose.yml

Replace your current docker-compose.yml with the secure version:

```bash
cp docker-compose.secure.example.yml docker-compose.yml
```

### Step 2: Secure your .env file

```bash
# Create .env file with all your secrets
nano .env

# Set restrictive permissions (only owner can read/write)
chmod 600 .env
```

### Step 3: Secure data directory

```bash
# Set restrictive permissions on data directory
chmod 750 ./data
chown -R $(id -u):$(id -g) ./data
```

### Step 4: Use specific image version

Update your docker-compose.yml to use a specific version instead of `:latest`:

```yaml
image: ghcr.io/doubleangels/nova:v1.0.0  # Replace with actual version
```

## 🔒 Key Security Improvements Explained

### 1. **no-new-privileges:true**
- Prevents the container from gaining additional privileges
- Critical for preventing privilege escalation attacks

### 2. **cap_drop: ALL / cap_add: [minimal]**
- Drops all Linux capabilities
- Only adds the minimal capabilities needed (CHOWN, SETGID, SETUID)
- Reduces attack surface significantly

### 3. **read_only: true + tmpfs**
- Makes root filesystem read-only
- Uses tmpfs for writable directories (/tmp, /app/data)
- Prevents malicious file modifications

### 4. **Resource Limits**
- Prevents resource exhaustion attacks
- Limits CPU and memory usage
- Protects host system

### 5. **Log Rotation**
- Prevents disk fill attacks
- Automatically rotates logs
- Compresses old logs

### 6. **Specific Image Tags**
- Avoids unexpected updates from `:latest`
- Enables reproducible deployments
- Better for security auditing

### 7. **Volume Security Options**
- `noexec`: Prevents executing binaries from volume
- `nosuid`: Prevents setuid/setgid bits
- `nodev`: Prevents device files

## 📋 Security Checklist

- [ ] Use specific image tags (not `:latest`)
- [ ] Set `.env` file permissions to 600
- [ ] Set data directory permissions to 750
- [ ] Enable `no-new-privileges`
- [ ] Drop all capabilities, add only needed ones
- [ ] Enable read-only root filesystem
- [ ] Set resource limits
- [ ] Enable log rotation
- [ ] Use volume security options
- [ ] Add health checks
- [ ] Regularly update base images
- [ ] Scan images for vulnerabilities (Trivy, Snyk)

## 🔍 Additional Security Measures

### Regular Vulnerability Scanning

```bash
# Install Trivy
brew install trivy  # macOS
# or
sudo apt-get install trivy  # Linux

# Scan your image
trivy image ghcr.io/doubleangels/nova:latest
```

### Update Base Images Regularly

```bash
# Check for updates
docker pull node:24-alpine

# Rebuild with updated base
docker build -t nova:latest .
```

### Monitor Container Logs

```bash
# Check for suspicious activity
docker logs nova | grep -i "error\|warn\|unauthorized"
```

## 🛡️ Advanced Security (Optional)

### Use Docker Secrets (Docker Swarm)

If using Docker Swarm, use secrets instead of environment variables:

```yaml
secrets:
  discord_bot_token:
    file: ./secrets/discord_bot_token.txt
```

### Add Seccomp Profile

Create a custom seccomp profile to restrict system calls (see DOCKER_SECURITY.md)

### Network Isolation

If the bot doesn't need external access:

```yaml
networks:
  discord:
    internal: true
```

## 📚 Full Documentation

See `DOCKER_SECURITY.md` for comprehensive security recommendations and advanced configurations.

