FROM node:16.8-alpine

RUN addgroup -S reddit \
 && adduser -S reddit -G reddit \
 && mkdir /app \
 && chown -R reddit:reddit /app

USER reddit
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install

COPY . .

CMD ["node", "/app/src/index.js"]
