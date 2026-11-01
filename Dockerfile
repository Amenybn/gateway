# gateway : Node.js 20, aucune dépendance npm. Seul composant exposé publiquement.
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    CATALOG_URL=http://catalog-service:8001 \
    ORDERS_URL=http://order-service:8002
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# Non-root numérique, aucune écriture disque
USER 1000:1000
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health | grep -q UP || exit 1

CMD ["node", "src/server.js"]
