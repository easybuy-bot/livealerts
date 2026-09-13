FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["npm","start"]
