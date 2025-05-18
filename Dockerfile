# Dockerfile for Node.js Application (e.g., js-auth or webquiz)

# ---- Base Stage ----
# Use an official Node.js runtime as a parent image.
# Alpine Linux is a good choice for smaller image sizes.
FROM node:18-alpine AS base

# Set the working directory in the container.
WORKDIR /usr/src/app

# ---- Builder Stage ----
# This stage builds dependencies that might be needed for build steps
# and can be used to create a pruned node_modules if necessary.
FROM base AS builder

# Copy package.json and package-lock.json (if available) first.
COPY package*.json ./

# Install all dependencies (including devDependencies if you had a build script that needed them)
# If you have a build script in package.json (e.g., for TypeScript, SASS), run it here:
# RUN npm install --silent
# RUN npm run build
# For simple apps without a separate build step, just installing might be enough
# or you can skip this stage if you install directly in the production stage.
# For this example, we'll assume no complex build step, so this stage can be minimal
# if we install prod deps directly in the final stage.
# If you want to be sure devDeps are available for any potential implicit build, use:
RUN npm install --silent


# ---- Production Stage ----
# This stage creates the final, lean production image.
FROM node:18-alpine AS production

# Set NODE_ENV to production.
ENV NODE_ENV=production

# Set the working directory for the production stage.
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install ONLY production dependencies.
# This runs as root, so it has permission to create node_modules.
# Using --omit=dev is equivalent to npm install --production
# --ignore-scripts can prevent some post-install issues if not needed.
RUN npm install --omit=dev --ignore-scripts --silent

# Copy the rest of your application code from the build context.
# Ensure you have a .dockerignore file in the app's root directory
# to exclude local node_modules, .git, .env, Dockerfile, .dockerignore etc.
COPY . .

# Create a non-root user and group for security.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Change ownership of the entire application directory to the new user.
# This is crucial so that the appuser can read/execute files and potentially write to logs if needed.
RUN chown -R appuser:appgroup /usr/src/app

# Switch to the non-root user.
USER appuser

# Application healthcheck (adapt port and path if necessary).
# PORT here will be substituted by the PORT environment variable passed by Docker Compose.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:${PORT:-3000}/', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', (err) => { console.error('Healthcheck failed for app:', err); process.exit(1); })" || exit 1

# Expose the port the app runs on (defined by PORT env var).
EXPOSE ${PORT:-3000} # Default to 3000 if PORT is not set

# Define the command to run your app using the "start" script from package.json.
CMD [ "npm", "start" ]
