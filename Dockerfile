from node:alpine
LABEL maintainer="Automattic"

# All for installing dependencies of nodegit
RUN apk update && \
    apk upgrade && \
    apk add git libgit2-dev && \
    apk add python tzdata pkgconfig build-base && \
    yarn install --production nodegit

# install rest of dependencies
COPY package.json yarn.lock tsconfig.json ./
RUN yarn --production

COPY src ./src
COPY logs ./logs
RUN yarn build-ts

CMD yarn serve
