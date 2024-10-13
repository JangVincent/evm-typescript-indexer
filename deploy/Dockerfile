###################
# BUILD FOR PRODUCTION
###################
FROM node:20 as builder

WORKDIR /app
COPY . .
RUN yarn

###################
# PRODUCTION
###################
FROM node:18-alpine as production

WORKDIR /app
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ARG VERSION
ENV VERSION $VERSION

EXPOSE 3000
CMD yarn run start
