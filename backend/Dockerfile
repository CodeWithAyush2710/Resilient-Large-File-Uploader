FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json .

RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

CMD ["npm", "run", "dev"]