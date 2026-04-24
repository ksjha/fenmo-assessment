FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/

RUN npm ci
RUN npm ci --prefix server

COPY . .

RUN npm run build


FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 3001

CMD ["npm", "run", "start", "--prefix", "server"]
