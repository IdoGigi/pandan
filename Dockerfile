# Pandan runs as one small Node service that serves both the API and the UI.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
# --ignore-scripts so postinstall never writes a .env into the image.
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/data/pandan.db
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/package.json ./

# No VOLUME here on purpose. It would force an anonymous volume on everyone,
# and some hosts reject it outright. docker-compose.yml mounts /data itself,
# and the server creates the folder if it is missing.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
