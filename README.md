# dserve

[![CircleCI](https://circleci.com/gh/Automattic/dserve/tree/master.svg?style=svg&circle-token=061a56710d3d75a9251ff74141b1c758a0790461)](https://circleci.com/gh/Automattic/dserve/tree/master)

![](https://raw.githubusercontent.com/Automattic/dserve/f699948673de4600a181484f5ab96a4a153eb552/logo.png)

A development server for serving branches of your docker-based web application an on-demand basis.

It can build images for any hash, run containers, stop containers that haven't been accessed in a
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

## Source Code Overview

At the end of the day, dserve is node express server written in typescript. It can trigger docker image
builds and deletions, start and stop containers, and a few other tricks.

Here is an example flow of what happens when requesting a never-requested-before commit sha:
1. User tries to access `https://dserve.a8c.com?hash=hash`.
2. dserve will query the local fs and docker daemon to determine the status of the corresponding image. It will discover that `hash` has never been requested before and needs to build an image for it. Therefore it will add the hash to the build queue and send the user a screen saying "starting a build for requested hash".
3. Internally dserve checks the build queue very frequently and will initate a build within seconds. The build takes places within its own temporary directory in a place like: `/tmp/dserve-calyspo-hash/repo` and logs will be stored in `/tmp/dserve-calypso-hash/dserve-build-log.txt`.
4. When a user requests the branch while the build is happening, dserve will recognize that the build is in progress and show the user the build's status.
5. Finally when the build completes, the next time a user requests the branch they will see: "starting container, this page will refresh in a couple of seconds".


**index.ts**: this acts as the entry point for dserve.  it sets up the server, initializes the routes, and contains the request handling for each incoming route.

**middlewares.ts** this file contains all of the middlewares that dserve uses.

  1. _determineCommitHash_: every request to dserve needs to be associated with a commit hash or else it cannot be fulfilled.  this middleware will attach a `commitHash` to the express request based on: session, and query params (branch or hash).
  2. _session_: standard session middleware so that each request doesn't need to specify a hash with a query param.

**api.ts**: Contains all of the code that interfaces with external things like the fs, docker, or github.  there are two kinds of entities that exist in this file, those that periodically update data and the other is helper functions for things that need to be done on-demand.

_periodically repeating_: updating the git branches to commit hash mapping, updating which docker images are available from the local docker server, stopping unused containers.

_on-demand helper functions_: this includes functionality for recording how recently a commitHash was accessed, a helper for proxying a request to the right container, helpers for checking the progress/state of a a commit, etc.

**builder.ts**: Contains all of the code for building the docker images for a specific commit hash.  This includes making build queue and rate limiting dserve to N builds at a time.

**logger.ts**: Exports a couple key items around loggers including the application logger and a getter for configuring a specific logger per-docker build of commits.
