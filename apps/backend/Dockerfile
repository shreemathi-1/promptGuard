FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 4000
# Seeding is idempotent (skips existing patterns), so it is safe on every start.
CMD ["sh", "-c", "node src/patterns/seedPatterns.js && node src/app.js"]
