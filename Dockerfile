FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# better-sqlite3 ships prebuilt binaries for linux x64/arm64; build tools are a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY index.html ./index.html
# Potto answers from the help guide. Without it, every question reads "my guide doesn't cover it".
COPY docs/help.md ./docs/help.md
ENV DATA_DIR=/app/data PORT=3000
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
