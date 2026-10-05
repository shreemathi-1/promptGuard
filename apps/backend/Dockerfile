FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 4000
# Migrations and seeding are idempotent, so they are safe on every start.
CMD ["sh", "-c", "node src/db/migrate.js && node src/patterns/seedPatterns.js && node src/app.js"]
