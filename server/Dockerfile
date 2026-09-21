FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=10000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "--experimental-strip-types", "src/index.ts"]

