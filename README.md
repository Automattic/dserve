# dserve

[![CircleCI](https://circleci.com/gh/Automattic/dserve/tree/master.svg?style=svg&circle-token=061a56710d3d75a9251ff74141b1c758a0790461)](https://circleci.com/gh/Automattic/dserve/tree/master)

<img src="https://raw.githubusercontent.com/Automattic/dserve/f699948673de4600a181484f5ab96a4a153eb552/logo.png" width=256 />

A development server for serving branches of your docker-based web application an on-demand basis.

It can build images for any hash, run containers, stop containers that haven't been accessed in a
while, proxy requests to the right container based on query params, etc.

## Install

```bash
git clone git@github.com:Automattic/dserve.git
cd dserve
nvm use
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

1. User tries to access `https://calypso.live?hash=hash`.
2. dserve will query the local fs and docker daemon to determine the status of the corresponding image. It will discover that `hash` has never been requested before and needs to build an image for it. Therefore it will add the hash to the build queue and send the user a screen saying "starting a build for requested hash".
3. If the branch or hash exist, dserve will redirect the user to https://hash-$hash.calypso.live, isolating the build to a subdomain
4. Internally dserve checks the build queue very frequently and will initate a build within seconds. The build takes places within its own temporary directory in a place like: `/tmp/dserve-calyspo-hash/repo` and logs will be stored in `/tmp/dserve-calypso-hash/dserve-build-log.txt`.
5. When a user requests the branch while the build is happening, dserve will recognize that the build is in progress and show the user the build's status.
6. Finally when the build completes, the next time a user requests the branch they will see: "starting container, this page will refresh in a couple of seconds".

**index.ts**: this acts as the entry point for dserve. it sets up the server, initializes the routes, and contains the request handling for each incoming route.

**middlewares.ts** this file contains all of the middlewares that dserve uses.

1. _redirectHashFromQueryStringToSubdomain_: This middleware will look for a branch or hash in the query string and redirect to a corresponding subdomain matching the commit hash.
2. _determineCommitHash_: Every request to dserve needs to be associated with a commit hash or else it cannot be fulfilled. this middleware will attach a `commitHash` to the express request based on the subdomain.
3. _session_: Standard session middleware so that each request doesn't need to specify a hash with a query param.

**api.ts**: Contains all of the code that interfaces with external things like the fs, docker, or github. there are two kinds of entities that exist in this file, those that periodically update data and the other is helper functions for things that need to be done on-demand.

_periodically repeating_: updating the git branches to commit hash mapping, updating which docker images are available from the local docker server, stopping unused containers.

_on-demand helper functions_: this includes functionality for recording how recently a commitHash was accessed, a helper for proxying a request to the right container, helpers for checking the progress/state of a a commit, etc.

**builder.ts**: Contains all of the code for building the docker images for a specific commit hash. This includes making build queue and rate limiting dserve to N builds at a time.

**logger.ts**: Exports a couple key items around loggers including the application logger and a getter for configuring a specific logger per-docker build of commits.

## Operations

Are you in a situation where you are suddently tasked with maintaining dserve even though you didn't write it?
Once the flood of mixed feelings towards the original authors settles, it'd be a good idea to read this section.
You probably want to know how to do things like, deploy new code, debug issues, and e2e test dserve locally.
Here goes nothing:

**deploying**
This GitHub repo is polled every 15 minutes. If there have been updates to the repo, then the latest sha is deployed.
Thats it. Merge, and it'll be deployed. In a high severity situation where dserve is broken, you'll want to make sure you time your attempts to fix it _before_ the next 15 minute mark.

**debugging**
dserve has a couple helpful urls for debugging issues for times when you don't have ssh access.
Note that any time you see `branch=${branchName}` you can subsitute `hash=${sha}`.

- Application Log: https://calypso.live/log
- List of local Docker images: https://calypso.live/localimages
- Delete a build directory: add reset=1 as a query param like so https://calypso.live?branch=${branchName}&reset=1
- Build Status: https://calypso.live/status?branch=${branchName}

**e2e test locally**

1. start up dserve with `yarn start`
2. try to access a branch that you've never built before by going to localhost:3000?branch=${branchName}. After a successful build you should be proxied to calypso
3. try to access an already built branch (by looking at the result of `docker images` you can find repo-tags with the right sha to specify). After a succesfful build you should be proxied to that branch's version of calypso.
4. you might need access to the private Docker registry: PCYsg-stw-p2

**fixing errors**

- Docker connection error ("connect ENOENT /var/run/docker.sock"): You can easily fix this by running [sudo ln -s ~/.docker/run/docker.sock /var/run/docker.sock](https://github.com/lando/lando/issues/3533#issuecomment-1464252377)
- Error when building image: Make sure the image of the branch you are trying to build is available.

**things that have broken in the past**

1. We were running an older version of docker that had `buildCache` issues. disabling the build cache (as a setting in the `buildImage` function) until we could upgrade docker versions solved the issue
2. The Docker Daemon ran into problems: there was one instance where builds seemed to just hang randomly and there was no obvious cause. all builds had failed. Systems restarting the docker daemon solved the issue.
3. Double slash branches: there is an interesting property of git with respect to how branches get stored on the local filesystem. Each slash in a branchname actually means that it occupies a nested folder. That means if locally you have a branch named `thing/thing2` then you _cannot_ pull down a remote branch with the name `thing`. The reason the remote repo was capable of having branch `thing/thing2` is because `thing` had already been deleted in its repo. The fix here is to always run a `git prune` when pulling down new branches which automatically deletes the appropriates local branches that no longer exist in the remote repo.
