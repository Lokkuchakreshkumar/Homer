FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8787
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "src/index.ts"]
