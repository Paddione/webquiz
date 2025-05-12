# Dockerfile

# Stage 1: Use an official Node.js runtime as a parent image
FROM node:18-alpine AS builder

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install app dependencies
# Using --only=production for smaller final image, but for dev, you might want devDependencies
RUN npm install --omit=dev 
# If you have a build step for frontend (e.g., React, Vue, Angular), do it here.
# For this simple app, we don't have a separate build step for the frontend.

# Copy the rest of the application code
COPY . .
# This will copy server.js, the public folder, and questions.json into the WORKDIR

# The server will run on port 3000 by default (as defined in server.js)
EXPOSE 3000

# Define the command to run the application
CMD [ "node", "server.js" ]
