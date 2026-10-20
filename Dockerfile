# ---- stage 1: build client ----
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# ---- stage 2: production ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY scripts ./scripts
COPY --from=client-build /app/client/dist ./client/dist
USER node
EXPOSE 6767
CMD ["node", "server/index.js"]
