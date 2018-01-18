# dserve

[![CircleCI](https://circleci.com/gh/Automattic/dserve/tree/master.svg?style=svg)](https://circleci.com/gh/Automattic/dserve/tree/master)

A development server for serving branches of your docker-based web application an on-demand basis.

It can build images for any hash, run containers, stop a containers that haven't been accessed in a
while, proxy requests to the right container based on query params, etc.

## Install

```bash
git clone git@github.com:Automattic/dserve.git
cd dserve
yarn
yarn start
```

## Use

You will need to modify your hosts file to include the following line:

```
127.0.0.1 calypso.localhost
```

Then you may either specify a branch or a hash to load.

1. branch: calypso.localhost:3000?branch={branchName}
2. hash: calypso.localhost:3000?hash={commitHash}

## logging

dserve uses `node-bunyan` for structured logging. Most logs are both written to the console and written to the file ./logs/log.txt.
The build log for each individual image is written to its build directory and is retained in the case of a failed build.

## Source Code

The source for dserve split into a few files.

**index.ts**: this acts as the entry point for dserve.  it sets up the server, initializes the routes, and contains the request handling for each incoming route.

**middlewares.ts** this file contains all of the middlewares that dserve uses.

  1. _determineCommitHash_: every request to dserve needs to be associated with a commit hash or else it cannot be fulfilled.  this middleware will attach a `commitHash` to the express request based on: session, and query params (branch or hash).
  2. _session_: standard session middleware so that each request doesn't need to specify a hash with a query param.

**api.ts**: Contains all of the code that interfaces with external things like the fs, docker, or github.  there are two kinds of entities that exist in this file, those that periodically update data and the other is helper functions for things that need to be done on-demand.

_periodically repeating_: updating the git branches to commit hash mapping, updating which docker images are available from the local docker server, stopping unused containers.

_on-demand helper functions_: this includes functionality for recording how recently a commitHash was accessed, a helper for proxying a request to the right container, helpers for checking the progress/state of a a commit, etc.

**builder.ts**: Contains all of the code for building the docker images for a specific commit hash.  This includes making build queue and rate limiting dserve to N builds at a time.

**logger.ts**: Exports a couple key items around loggers including the application log and a getter for configuring a specific logger per-docker build of commits.