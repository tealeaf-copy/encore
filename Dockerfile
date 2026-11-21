FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
# better-sqlite3 ships prebuilt binaries for linux x64/arm64; build tools are a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY index.html ./index.html
ENV DATA_DIR=/app/data PORT=3000
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
