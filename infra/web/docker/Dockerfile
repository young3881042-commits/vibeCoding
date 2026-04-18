FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["sh", "-lc", "node node_modules/vite/bin/vite.js --host 0.0.0.0 --port ${WEB_PORT:-5173}"]
