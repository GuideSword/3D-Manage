FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node
EXPOSE 5000
CMD ["node", "server.js"]
