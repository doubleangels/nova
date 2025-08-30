# Docker Build Workflow

This workflow builds and pushes the Nova Discord bot Docker image to Google Artifact Registry (GAR).

## Prerequisites

Before using this workflow, you need to set up the following GitHub secrets:

### Required Secrets

1. **`GCP_SA_KEY`**: The JSON service account key for Google Cloud Platform

   - Create a service account in GCP with the following roles:
     - `Artifact Registry Repository Administrator`
     - `Artifact Registry Writer`
   - Download the JSON key and add it as a secret

2. **`GCP_PROJECT_ID`**: Your Google Cloud Project ID

   - Example: `my-project-123456`

3. **`GAR_REGISTRY`**: Your Google Artifact Registry URL
   - Format: `{region}-docker.pkg.dev/{project-id}/{repository-name}`
   - Example: `us-central1-docker.pkg.dev/my-project-123456/nova-repo`

## Setup Steps

1. **Create Artifact Registry Repository**:

   ```bash
   gcloud artifacts repositories create nova-repo \
     --repository-format=docker \
     --location=us-central1 \
     --description="Nova Discord Bot Docker Repository"
   ```

2. **Create Service Account**:

   ```bash
   gcloud iam service-accounts create github-actions \
     --display-name="GitHub Actions Service Account"
   ```

3. **Grant Permissions**:

   ```bash
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/artifactregistry.admin"
   ```

4. **Download Service Account Key**:

   ```bash
   gcloud iam service-accounts keys create key.json \
     --iam-account=github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com
   ```

5. **Add GitHub Secrets**:
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Add the three required secrets mentioned above

## Usage

1. **Manual Trigger**: Go to Actions tab → "Build and Push Docker Image to GAR" → "Run workflow"
2. **Optional Inputs**:
   - `image_tag`: Custom tag for the image (default: latest)
   - `registry_region`: GAR region (default: us-central1)

## Workflow Features

- **Multi-platform builds**: Supports both AMD64 and ARM64 architectures
- **Layer caching**: Uses GitHub Actions cache for faster builds
- **Automatic tagging**: Creates tags based on branch, PR, and semantic versions
- **Security**: Uses non-root user and proper signal handling
- **Optimized**: Uses Alpine Linux base image for smaller size

## Pulling the Image

After the workflow completes, you can pull the image using:

```bash
docker pull us-central1-docker.pkg.dev/YOUR_PROJECT_ID/nova-repo/nova-discord-bot:latest
```

## Troubleshooting

- **Authentication errors**: Verify your service account has the correct permissions
- **Registry not found**: Ensure the Artifact Registry repository exists
- **Build failures**: Check the Dockerfile and ensure all dependencies are properly specified
